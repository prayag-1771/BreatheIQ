import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {
  aws_dynamodb as ddb, aws_lambda as lambda, aws_iot as iot, aws_iam as iam, aws_events as events,
  aws_events_targets as targets, aws_scheduler as scheduler, aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks, aws_s3 as s3, aws_sns as sns, aws_ssm as ssm, aws_cognito as cognito,
  aws_apigatewayv2 as apigw, aws_logs as logs, aws_location as location,
  custom_resources as cr,
} from 'aws-cdk-lib'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'

export const TRAIN_ID = '12302'
export const COACH = 'B2'
export const COACH_CODES = ['SLR', 'GS', 'S1', 'S2', 'S3', 'B1', 'B2', 'B3', 'PC', 'A1', 'B4', 'EOG']
export const GUEST_ROLE = 'breatheiq-guest'
export const OPERATOR_ROLE = 'breatheiq-operator'
const MODEL_PARAM = '/breatheiq/model/current'
const SMS_PARAM = '/breatheiq/sms/numbers'

export interface CoreProps extends cdk.StackProps {
  fastModel: string
  strongModel: string
  smInstance: string
}

/**
 * Data pipeline, model serving, Bad Day playbook, API and auth.
 * Device → IoT Core → process-frame → (model · DynamoDB · command · EventBridge) → Step Functions.
 */
export class CoreStack extends cdk.Stack {
  readonly dataBucket: s3.Bucket
  readonly staffTopic: sns.Topic
  readonly fns: Record<'simulator' | 'process' | 'inference' | 'api' | 'chat' | 'playbook' | 'agentActions' | 'geofence', lambda.Function>
  readonly stateMachine: sfn.StateMachine
  readonly tables: Record<'telemetry' | 'state' | 'incidents' | 'interlock' | 'alerts', ddb.Table>

  constructor(scope: Construct, id: string, props: CoreProps) {
    super(scope, id, props)
    const { region, account } = this
    const arn = (service: string, resource: string) => `arn:aws:${service}:${region}:${account}:${resource}`

    // ── storage ────────────────────────────────────────────────────
    const table = (name: string, sortKey: boolean) =>
      new ddb.Table(this, name, {
        partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
        sortKey: sortKey ? { name: 'sk', type: ddb.AttributeType.NUMBER } : undefined,
        billingMode: ddb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: 'ttl',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      })
    this.tables = {
      telemetry: table('Telemetry', true),
      state: table('CoachState', false),
      incidents: table('Incidents', false),
      interlock: table('InterlockLog', true),
      alerts: table('Alerts', true),
    }
    const T = this.tables

    this.dataBucket = new s3.Bucket(this, 'Data', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ prefix: 'audio/', expiration: cdk.Duration.days(30) }],
    })
    const bucket = this.dataBucket

    this.staffTopic = new sns.Topic(this, 'StaffAlerts', { topicName: 'breatheiq-staff-alerts', displayName: 'BreatheIQ staff alerts' })
    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'breatheiq' })

    // ── IoT Core: a thing per coach, a device policy, and the rule that feeds the pipeline ──
    for (const code of COACH_CODES) {
      new iot.CfnThing(this, `Thing${code}`, { thingName: `breatheiq-${TRAIN_ID}-${code}`, attributePayload: { attributes: { trainId: TRAIN_ID, coach: code } } })
    }
    new iot.CfnPolicy(this, 'DevicePolicy', {
      policyName: 'breatheiq-coach-device',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Action: 'iot:Connect', Resource: arn('iot', 'client/${iot:Connection.Thing.ThingName}') },
          { Effect: 'Allow', Action: 'iot:Publish', Resource: arn('iot', `topic/breatheiq/${TRAIN_ID}/*/telemetry`) },
          { Effect: 'Allow', Action: 'iot:Subscribe', Resource: arn('iot', `topicfilter/breatheiq/${TRAIN_ID}/*/command`) },
          { Effect: 'Allow', Action: 'iot:Receive', Resource: arn('iot', `topic/breatheiq/${TRAIN_ID}/*/command`) },
        ],
      },
    })
    const endpoint = new cr.AwsCustomResource(this, 'IotEndpointLookup', {
      onUpdate: {
        service: 'Iot', action: 'describeEndpoint', parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: cr.PhysicalResourceId.of('iot-data-ats-endpoint'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({ actions: ['iot:DescribeEndpoint'], resources: ['*'] })]),
      installLatestAwsSdk: false,
    })
    const iotEndpoint = endpoint.getResponseField('endpointAddress')

    // ── Amazon Location: train tracker + route geofences + a map key ──
    const tracker = new location.CfnTracker(this, 'Tracker', { trackerName: 'breatheiq-train', positionFiltering: 'TimeBased', description: `Train ${TRAIN_ID}` })
    const geofences = new location.CfnGeofenceCollection(this, 'Geofences', { collectionName: 'breatheiq-route', description: 'Pollution zones on the route' })
    new location.CfnTrackerConsumer(this, 'TrackerConsumer', { trackerName: tracker.trackerName, consumerArn: geofences.attrArn }).node.addDependency(tracker)
    const mapKey = new location.CfnAPIKey(this, 'MapKey', {
      keyName: 'breatheiq-map', noExpiry: true, description: 'Read-only map tiles for the Fleet page',
      restrictions: { allowActions: ['geo-maps:GetTile', 'geo-maps:GetStaticMap'], allowResources: [`arn:aws:geo-maps:${region}::provider/default`] },
    })

    // ── SageMaker: training role (the model-registry group is created on first use: new accounts may have a 0 quota) ──
    const smRole = new iam.Role(this, 'SageMakerTrainingRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      description: 'BreatheIQ scikit-learn training jobs',
    })
    bucket.grantReadWrite(smRole)
    smRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      resources: [arn('logs', 'log-group:/aws/sagemaker/*')],
    }))
    smRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData', 'ecr:GetAuthorizationToken', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'],
      resources: ['*'],
    }))
    const MODEL_GROUP = 'breatheiq-rf'
    const sklearnImage = `683313688378.dkr.ecr.${region}.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3`

    // ── SSM Parameter Store: model IDs and flags (no secrets in git) ──
    const param = (id: string, name: string, value: string, description: string) =>
      new ssm.StringParameter(this, id, { parameterName: name, stringValue: value, description })
    param('FastModel', '/breatheiq/bedrock/fast-model', props.fastModel, 'Bedrock model for short generations (announcer, advice, explain)')
    param('StrongModel', '/breatheiq/bedrock/strong-model', props.strongModel, 'Bedrock model for the agent and incident reports')
    param('ExtraLanguage', '/breatheiq/flags/extra-language', 'bn', 'Amazon Translate target language for the advisory')

    // ── Lambda functions ───────────────────────────────────────────
    const baseEnv = {
      TRAIN_ID, COACH,
      TELEMETRY_TABLE: T.telemetry.tableName, STATE_TABLE: T.state.tableName, INCIDENTS_TABLE: T.incidents.tableName,
      INTERLOCK_TABLE: T.interlock.tableName, ALERTS_TABLE: T.alerts.tableName,
      IOT_ENDPOINT: iotEndpoint, EVENT_BUS: bus.eventBusName, DATA_BUCKET: bucket.bucketName,
      OPERATOR_ROLE, MODEL_PARAM,
    }
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY })
    const nodeFn = (id: string, dir: string, opts: Partial<lambda.FunctionProps> = {}) =>
      new lambda.Function(this, id, {
        functionName: `breatheiq-${dir}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '..', 'dist', dir)),
        memorySize: 256,
        timeout: cdk.Duration.seconds(15),
        logGroup: logGroup(id),
        ...opts,
        environment: { ...baseEnv, ...(opts.environment ?? {}) },
      })

    const inference = nodeFn('Inference', 'rf-inference', {
      description: 'Four Random-Forest heads trained by SageMaker, served as exported decision trees',
      timeout: cdk.Duration.seconds(30),
    })
    bucket.grantRead(inference, 'models/*')
    inference.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [arn('ssm', `parameter${MODEL_PARAM}`)] }))

    const simulator = nodeFn('Simulator', 'simulator', { timeout: cdk.Duration.seconds(75), memorySize: 128, description: 'Coach B2 device simulator: one telemetry frame every 2 s' })
    const processFn = nodeFn('ProcessFrame', 'process-frame', {
      description: 'IoT Rule target: model, AQI, interlock, rules, DynamoDB, command, events',
      environment: { INFERENCE_FN: inference.functionName, TRACKER: tracker.trackerName },
    })
    const playbookFn = nodeFn('Playbook', 'playbook', {
      timeout: cdk.Duration.seconds(60), memorySize: 512, description: 'Bad Day playbook tasks',
      environment: { STAFF_TOPIC_ARN: this.staffTopic.topicArn, SMS_PARAM, EXTRA_LANGUAGE: 'bn' },
    })
    const agentActions = nodeFn('AgentActions', 'agent-actions', { description: 'Ask BreatheIQ: Bedrock Agent action group' })
    const geofenceFn = nodeFn('Geofence', 'geofence', {
      description: 'Amazon Location geofence events → pre-emptive ventilation',
      environment: { GEOFENCE_COLLECTION: geofences.collectionName },
    })
    const chatFn = nodeFn('Chat', 'chat', { timeout: cdk.Duration.seconds(60), memorySize: 512, description: 'Ask BreatheIQ: streamed chat' })

    // ── Step Functions: the Bad Day playbook ──
    const step = (name: string, id: string) =>
      new tasks.LambdaInvoke(this, name, {
        lambdaFunction: playbookFn,
        payload: sfn.TaskInput.fromObject({ step: id, 'incident.$': '$', 'executionArn.$': '$$.Execution.Id' }),
        payloadResponseOnly: true,
      }).addRetry({ maxAttempts: 2, interval: cdk.Duration.seconds(2), backoffRate: 2 })
    const wait = new sfn.Wait(this, 'Wait for the air to recover', { time: sfn.WaitTime.duration(cdk.Duration.seconds(20)) })
    const report = step('Bedrock · write incident report', 'report')
    const chain = step('Bedrock · write announcement (EN + HI)', 'announce')
      .next(step('Polly · synthesize speech', 'speak'))
      .next(step('SNS · notify staff and send SMS', 'notify'))
      .next(step('Translate · regional-language advisory', 'translate'))
      .next(step('DynamoDB · save incident', 'save'))
      .next(wait)
      .next(step('Check incident status', 'check'))
      .next(new sfn.Choice(this, 'Incident closed?')
        .when(sfn.Condition.or(sfn.Condition.booleanEquals('$.closed', true), sfn.Condition.numberGreaterThan('$.loops', 45)), report)
        .otherwise(wait))
    this.stateMachine = new sfn.StateMachine(this, 'BadDayPlaybook', {
      stateMachineName: 'breatheiq-bad-day-playbook',
      definitionBody: sfn.DefinitionBody.fromChainable(chain),
      timeout: cdk.Duration.minutes(30),
    })

    const api = nodeFn('Api', 'api', {
      timeout: cdk.Duration.seconds(29), memorySize: 512, description: 'Dashboard API',
      environment: {
        INFERENCE_FN: inference.functionName, PROCESS_FN: processFn.functionName,
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn, STATE_MACHINE_NAME: this.stateMachine.stateMachineName,
        SM_ROLE_ARN: smRole.roleArn, SM_INSTANCE: props.smInstance, SKLEARN_IMAGE: sklearnImage, MODEL_GROUP,
        TRACKER: tracker.trackerName, GEOFENCE_COLLECTION: geofences.collectionName,
      },
    })
    this.fns = { simulator, process: processFn, inference, api, chat: chatFn, playbook: playbookFn, agentActions, geofence: geofenceFn }

    // ── least-privilege grants ──
    const iotPublish = new iam.PolicyStatement({ actions: ['iot:Publish'], resources: [arn('iot', `topic/breatheiq/${TRAIN_ID}/*`)] })
    const bedrockInvoke = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:ApplyGuardrail'],
      resources: ['arn:aws:bedrock:*::foundation-model/*', arn('bedrock', 'inference-profile/*'), arn('bedrock', 'guardrail/*')],
    })
    const bedrockParams = new iam.PolicyStatement({
      actions: ['ssm:GetParametersByPath'], resources: [arn('ssm', 'parameter/breatheiq/bedrock'), arn('ssm', 'parameter/breatheiq/bedrock/*')],
    })

    T.state.grantReadWriteData(simulator)
    simulator.addToRolePolicy(iotPublish)

    for (const t of [T.telemetry, T.state, T.interlock, T.alerts]) t.grantReadWriteData(processFn)
    inference.grantInvoke(processFn)
    bus.grantPutEventsTo(processFn)
    processFn.addToRolePolicy(iotPublish)
    processFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['geo:BatchUpdateDevicePosition'], resources: [tracker.attrArn] }))

    T.state.grantReadWriteData(playbookFn)
    T.incidents.grantReadWriteData(playbookFn)
    bucket.grantPut(playbookFn, 'audio/*')
    bucket.grantPut(playbookFn, 'reports/*')
    this.staffTopic.grantPublish(playbookFn)
    playbookFn.addToRolePolicy(bedrockInvoke)
    playbookFn.addToRolePolicy(bedrockParams)
    playbookFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech', 'translate:TranslateText'], resources: ['*'] }))
    // direct-to-phone SMS has no topic ARN; NotResource keeps this statement from covering any topic
    playbookFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], notResources: ['arn:aws:sns:*:*:*'] }))
    playbookFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [arn('ssm', `parameter${SMS_PARAM}`)] }))

    for (const t of [T.telemetry, T.incidents, T.interlock, T.alerts]) t.grantReadData(api)
    T.state.grantReadWriteData(api)
    bucket.grantRead(api)
    inference.grantInvoke(api)
    api.addToRolePolicy(bedrockInvoke)
    api.addToRolePolicy(bedrockParams)
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:ListExecutions'], resources: [this.stateMachine.stateMachineArn] }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:GetExecutionHistory'], resources: [arn('states', `execution:${this.stateMachine.stateMachineName}:*`)] }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['sagemaker:CreateTrainingJob', 'sagemaker:DescribeTrainingJob', 'sagemaker:AddTags'], resources: [arn('sagemaker', 'training-job/breatheiq-rf-*')] }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['sagemaker:ListTrainingJobs', 'cloudwatch:GetMetricData'], resources: ['*'] }))
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sagemaker:CreateModelPackage', 'sagemaker:CreateModelPackageGroup', 'sagemaker:DescribeModelPackageGroup'],
      resources: [arn('sagemaker', `model-package/${MODEL_GROUP}/*`), arn('sagemaker', `model-package-group/${MODEL_GROUP}`)],
    }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [smRole.roleArn], conditions: { StringEquals: { 'iam:PassedToService': 'sagemaker.amazonaws.com' } } }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter', 'ssm:PutParameter'], resources: [arn('ssm', `parameter${MODEL_PARAM}`)] }))
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['geo:ListGeofences'], resources: [geofences.attrArn] }))

    for (const fn of [chatFn, agentActions]) {
      for (const t of [T.incidents, T.interlock, T.alerts]) t.grantReadData(fn)
      T.state.grantReadWriteData(fn)
    }
    chatFn.addToRolePolicy(bedrockParams)
    chatFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeAgent'], resources: [arn('bedrock', 'agent-alias/*')] }))

    T.state.grantReadWriteData(geofenceFn)
    T.alerts.grantReadWriteData(geofenceFn)
    bus.grantPutEventsTo(geofenceFn)
    geofenceFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['geo:BatchPutGeofence'], resources: [geofences.attrArn] }))

    // ── wiring: IoT rule, schedule, event rules ──
    const rule = new iot.CfnTopicRule(this, 'TelemetryRule', {
      ruleName: 'breatheiq_telemetry',
      topicRulePayload: {
        description: 'Every coach telemetry frame goes to process-frame',
        sql: "SELECT *, topic(2) AS trainId, topic(3) AS coach, timestamp() AS receivedAt FROM 'breatheiq/+/+/telemetry'",
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        actions: [{ lambda: { functionArn: processFn.functionArn } }],
      },
    })
    processFn.addPermission('IotRule', { principal: new iam.ServicePrincipal('iot.amazonaws.com'), sourceArn: rule.attrArn })

    const schedulerRole = new iam.Role(this, 'SchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') })
    simulator.grantInvoke(schedulerRole)
    new scheduler.CfnSchedule(this, 'SimulatorSchedule', {
      name: 'breatheiq-device-simulator',
      description: 'Runs the coach simulator: one invocation per minute, 30 frames each',
      scheduleExpression: 'rate(1 minute)',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: { arn: simulator.functionArn, roleArn: schedulerRole.roleArn, retryPolicy: { maximumRetryAttempts: 0 } },
    })

    new events.Rule(this, 'OnAqiOffTheChart', {
      eventBus: bus, ruleName: 'breatheiq-aqi-off-the-chart',
      eventPattern: { source: ['breatheiq.pipeline'], detailType: ['AqiOffTheChart'] },
      targets: [new targets.SfnStateMachine(this.stateMachine, { input: events.RuleTargetInput.fromEventPath('$.detail') })],
    })
    new events.Rule(this, 'OnGeofenceEvent', {
      ruleName: 'breatheiq-geofence-events',
      eventPattern: { source: ['aws.geo'], detailType: ['Location Geofence Event'], resources: [geofences.attrArn] },
      targets: [new targets.LambdaFunction(geofenceFn)],
    })

    // ── auth: guest identities for the dashboard, an operator user pool for Controls ──
    const userPool = new cognito.UserPool(this, 'Operators', {
      userPoolName: 'breatheiq-operators', selfSignUpEnabled: false, signInAliases: { username: true },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: false },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const client = userPool.addClient('Dashboard', { authFlows: { userPassword: true }, generateSecret: false, preventUserExistenceErrors: true })
    const identityPool = new cognito.CfnIdentityPool(this, 'Identities', {
      identityPoolName: 'breatheiq', allowUnauthenticatedIdentities: true,
      cognitoIdentityProviders: [{ clientId: client.userPoolClientId, providerName: userPool.userPoolProviderName }],
    })
    const federated = (amr: 'authenticated' | 'unauthenticated') =>
      new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': amr },
      }, 'sts:AssumeRoleWithWebIdentity')
    const guestRole = new iam.Role(this, 'GuestRole', { roleName: GUEST_ROLE, assumedBy: federated('unauthenticated'), description: 'Dashboard visitors: read telemetry, call the API' })
    const operatorRole = new iam.Role(this, 'OperatorRole', { roleName: OPERATOR_ROLE, assumedBy: federated('authenticated'), description: 'Signed-in operator: same access, API unlocks Controls' })

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'breatheiq',
      corsPreflight: {
        allowOrigins: ['*'], allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
        allowHeaders: ['content-type', 'authorization', 'x-amz-date', 'x-amz-security-token', 'x-amz-content-sha256'], maxAge: cdk.Duration.hours(1),
      },
      defaultAuthorizer: new HttpIamAuthorizer(),
    })
    httpApi.addRoutes({ path: '/{proxy+}', methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST], integration: new HttpLambdaIntegration('ApiIntegration', api) })
    ;(httpApi.defaultStage!.node.defaultChild as apigw.CfnStage).defaultRouteSettings = { throttlingBurstLimit: 40, throttlingRateLimit: 20 }

    const chatUrl = chatFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM, invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: { allowedOrigins: ['*'], allowedMethods: [lambda.HttpMethod.POST], allowedHeaders: ['*'], maxAge: cdk.Duration.hours(1) },
    })

    for (const role of [guestRole, operatorRole]) {
      role.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Connect'], resources: [arn('iot', 'client/breatheiq-web-*')] }))
      role.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Subscribe'], resources: [arn('iot', `topicfilter/breatheiq/${TRAIN_ID}/*`)] }))
      role.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Receive'], resources: [arn('iot', `topic/breatheiq/${TRAIN_ID}/*`)] }))
      role.addToPolicy(new iam.PolicyStatement({ actions: ['execute-api:Invoke'], resources: [arn('execute-api', `${httpApi.apiId}/*/*/*`)] }))
      role.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:InvokeFunctionUrl', 'lambda:InvokeFunction'], resources: [chatFn.functionArn] }))
    }
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityRoles', {
      identityPoolId: identityPool.ref, roles: { unauthenticated: guestRole.roleArn, authenticated: operatorRole.roleArn },
    })

    // ── outputs (read by scripts/post-deploy.mjs → breatheiq/public/aws-config.json) ──
    const out = (name: string, value: string) => new cdk.CfnOutput(this, name, { value })
    out('Region', region)
    out('ApiUrl', httpApi.apiEndpoint)
    out('ChatUrl', chatUrl.url)
    out('IotEndpoint', iotEndpoint)
    out('IdentityPoolId', identityPool.ref)
    out('UserPoolId', userPool.userPoolId)
    out('UserPoolClientId', client.userPoolClientId)
    out('DataBucket', bucket.bucketName)
    out('StateMachineArn', this.stateMachine.stateMachineArn)
    out('ApiFunction', api.functionName)
    out('GeofenceFunction', geofenceFn.functionName)
    out('AgentActionsFunctionArn', agentActions.functionArn)
    out('MapKeyName', mapKey.keyName)
    out('StaffTopicArn', this.staffTopic.topicArn)
    out('TelemetryTopic', `breatheiq/${TRAIN_ID}/${COACH}/telemetry`)
    out('CommandTopic', `breatheiq/${TRAIN_ID}/${COACH}/command`)
  }
}
