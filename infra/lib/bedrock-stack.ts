import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { aws_bedrock as bedrock, aws_iam as iam, aws_lambda as lambda, aws_s3 as s3, aws_s3vectors as s3vectors, aws_ssm as ssm } from 'aws-cdk-lib'

export interface BedrockProps extends cdk.StackProps {
  dataBucket: s3.IBucket
  agentActions: lambda.IFunction
  agentModel: string
  embeddingModel: string
}

const BLOCKED = 'I can only give air-quality guidance for this train. For a health concern, please speak to train staff or a doctor.'

/**
 * Amazon Bedrock resources for "Ask BreatheIQ" and every passenger-facing generation:
 * two Guardrails, a Knowledge Base on Amazon S3 Vectors, and the Agent with its action group.
 * IDs are published to SSM under /breatheiq/bedrock/ where the Lambdas read them.
 */
export class BedrockStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BedrockProps) {
    super(scope, id, props)
    const { region, account } = this
    const arn = (resource: string) => `arn:aws:bedrock:${region}:${account}:${resource}`

    // ── Guardrails ──
    const guardrail = (cid: string, name: string, description: string, grounded: boolean) => {
      const g = new bedrock.CfnGuardrail(this, cid, {
        name, description, blockedInputMessaging: BLOCKED, blockedOutputsMessaging: BLOCKED,
        topicPolicyConfig: {
          topicsConfig: [
            {
              name: 'MedicalDiagnosis', type: 'DENY',
              definition: 'Diagnosing, confirming or ruling out a medical condition or the cause of a symptom for a person.',
              examples: ['Do I have asthma?', 'Is my chest pain a heart attack?', 'You are probably having an allergic reaction.'],
            },
            {
              name: 'MedicationAdvice', type: 'DENY',
              definition: 'Recommending, prescribing or dosing any medicine or treatment, including inhalers, tablets, steroids or oxygen.',
              examples: ['How many puffs of my inhaler should I take?', 'Which tablet should I take for wheezing?', 'Take two doses of salbutamol now.'],
            },
            {
              name: 'UnrelatedRequests', type: 'DENY',
              definition: 'Requests unrelated to train cabin air quality, this train, its sensors or the air-quality standards, such as politics, investing, or writing essays and code.',
              examples: ['Who should I vote for?', 'Write a poem about cricket.', 'Which stock should I buy?'],
            },
          ],
        },
        contentPolicyConfig: {
          filtersConfig: [
            ...['HATE', 'INSULTS', 'SEXUAL', 'VIOLENCE', 'MISCONDUCT'].map((type) => ({ type, inputStrength: 'HIGH', outputStrength: 'HIGH' })),
            { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
          ],
        },
        sensitiveInformationPolicyConfig: {
          piiEntitiesConfig: [
            { type: 'EMAIL', action: 'ANONYMIZE' }, { type: 'PHONE', action: 'ANONYMIZE' },
            { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' }, { type: 'PASSWORD', action: 'BLOCK' },
          ],
        },
        contextualGroundingPolicyConfig: grounded
          ? { filtersConfig: [{ type: 'GROUNDING', threshold: 0.6 }, { type: 'RELEVANCE', threshold: 0.5 }] }
          : undefined,
      })
      const version = new bedrock.CfnGuardrailVersion(this, `${cid}Version`, { guardrailIdentifier: g.attrGuardrailId, description: 'Deployed by CDK' })
      return { g, version }
    }
    const passenger = guardrail('PassengerGuardrail', 'breatheiq-passenger-safety', 'Announcements, advisories, advice and explanations: no diagnosis, no medication advice, PII filtered', false)
    const grounded = guardrail('GroundedGuardrail', 'breatheiq-ask-grounded', 'Ask BreatheIQ agent: same rules plus a contextual grounding check on Knowledge Base answers', true)

    // ── Knowledge Base on Amazon S3 Vectors (no always-on vector database) ──
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'KbVectors', { vectorBucketName: `breatheiq-kb-${account}` })
    const index = new s3vectors.CfnIndex(this, 'KbIndex', {
      vectorBucketName: vectorBucket.vectorBucketName, indexName: 'breatheiq-kb',
      dataType: 'float32', dimension: 1024, distanceMetric: 'cosine',
      metadataConfiguration: { nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'] },
    })
    index.node.addDependency(vectorBucket)

    const embeddingArn = `arn:aws:bedrock:${region}::foundation-model/${props.embeddingModel}`
    const kbRole = new iam.Role(this, 'KbRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', { conditions: { StringEquals: { 'aws:SourceAccount': account } } }),
    })
    kbRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [embeddingArn] }))
    kbRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [props.dataBucket.bucketArn], conditions: { StringLike: { 's3:prefix': ['kb/*'] } } }))
    kbRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [props.dataBucket.arnForObjects('kb/*')] }))
    kbRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3vectors:PutVectors', 's3vectors:GetVectors', 's3vectors:DeleteVectors', 's3vectors:QueryVectors', 's3vectors:GetIndex', 's3vectors:ListVectors'],
      resources: [index.attrIndexArn],
    }))

    const kb = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: 'breatheiq-kb',
      description: 'Hardware notes, README, CPCB / WHO / NAAQS / EPA guidance and sensor datasheet summaries',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: embeddingArn,
          embeddingModelConfiguration: { bedrockEmbeddingModelConfiguration: { dimensions: 1024, embeddingDataType: 'FLOAT32' } },
        },
      },
      storageConfiguration: { type: 'S3_VECTORS', s3VectorsConfiguration: { indexArn: index.attrIndexArn } },
    })
    kb.node.addDependency(kbRole)
    const source = new bedrock.CfnDataSource(this, 'KbDocs', {
      knowledgeBaseId: kb.attrKnowledgeBaseId, name: 'breatheiq-docs', dataDeletionPolicy: 'RETAIN',
      dataSourceConfiguration: { type: 'S3', s3Configuration: { bucketArn: props.dataBucket.bucketArn, inclusionPrefixes: ['kb/'] } },
      vectorIngestionConfiguration: { chunkingConfiguration: { chunkingStrategy: 'FIXED_SIZE', fixedSizeChunkingConfiguration: { maxTokens: 300, overlapPercentage: 20 } } },
    })

    // ── Agent ──
    const agentRole = new iam.Role(this, 'AgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', { conditions: { StringEquals: { 'aws:SourceAccount': account } } }),
    })
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:GetInferenceProfile', 'bedrock:GetFoundationModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/*', arn('inference-profile/*')],
    }))
    agentRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:Retrieve'], resources: [kb.attrKnowledgeBaseArn] }))
    agentRole.addToPolicy(new iam.PolicyStatement({ actions: ['bedrock:ApplyGuardrail'], resources: [grounded.g.attrGuardrailArn] }))

    const str = (description: string, required = false) => ({ type: 'string', description, required })
    const agent = new bedrock.CfnAgent(this, 'Agent', {
      agentName: 'breatheiq-ask',
      description: 'Ask BreatheIQ: operator copilot for train cabin air quality',
      foundationModel: props.agentModel,
      agentResourceRoleArn: agentRole.roleArn,
      autoPrepare: true,
      idleSessionTtlInSeconds: 900,
      instruction: [
        'You are Ask BreatheIQ, the operator copilot for a cabin air-quality system on Indian Railways train 12302.',
        'Answer questions about live coach air quality, the worst and cleanest coaches, the ozone safety interlock, exposure by passenger group and Bad Day incidents by calling the coach-operations functions; never guess a reading.',
        'For questions about standards, limits, sensors or safety, search the knowledge base and cite it.',
        'Give air-quality guidance only: never diagnose a condition and never recommend medicine. Be brief, specific and calm; give numbers with units.',
        'Only a signed-in operator may change the scenario; if setScenario reports that the user is not an operator, say so.',
      ].join(' '),
      guardrailConfiguration: { guardrailIdentifier: grounded.g.attrGuardrailId, guardrailVersion: grounded.version.attrVersion },
      knowledgeBases: [{
        knowledgeBaseId: kb.attrKnowledgeBaseId, knowledgeBaseState: 'ENABLED',
        description: 'Air-quality standards (CPCB AQI, WHO 2021, India NAAQS, EPA ozone), ozone safety, sensor specifications, sensitive-group guidance, the Bad Day playbook and the hardware build.',
      }],
      actionGroups: [{
        actionGroupName: 'coach-operations',
        description: 'Live data and controls for the train',
        actionGroupExecutor: { lambda: props.agentActions.functionArn },
        functionSchema: {
          functions: [
            { name: 'getCoachStatus', description: 'Current air quality, occupancy and (for the instrumented coach B2) sensor readings, relays, interlock verdict and model reply for one coach.', parameters: { coach: str('Coach code such as B2, S1 or GS. Defaults to B2.') } },
            { name: 'getWorstCoaches', description: 'The coaches with the worst air right now, with AQI, occupancy and the number of sensitive passengers, plus the cleanest coach.', parameters: { n: { type: 'integer', description: 'How many coaches to return (default 3).', required: false } } },
            { name: 'getInterlockLog', description: 'Ozone safety interlock decisions (blocked, allowed, released) with reason, occupancy and ozone estimate.', parameters: { sinceMinutes: { type: 'integer', description: 'How far back to look, in minutes (default 30).', required: false } } },
            { name: 'getExposure', description: 'PM2.5 dose, share of the WHO and India NAAQS daily budgets and risk level for one passenger group or all groups.', parameters: { group: str('children, elderly, respiratory, pregnant or staff. Omit for all groups.') } },
            { name: 'getIncident', description: 'A Bad Day incident: trigger, station, peak AQI, worst and cleanest coach, interlock verdict and the announcement.', parameters: { id: str('Incident id. Omit for the latest incident.') } },
            { name: 'setScenario', description: 'Operator only. Switch the coach simulator to a scenario: 1 normal, 2 platform rush, 3 heat wave, 4 smoke/gas, 5 stubble-burning haze belt, 6 tunnel dust, 7 everything at once.', parameters: { id: { type: 'integer', description: 'Scenario number 1-7.', required: true } } },
          ],
        },
      }],
    })
    agent.node.addDependency(agentRole)
    new lambda.CfnPermission(this, 'AgentInvokesActions', {
      action: 'lambda:InvokeFunction', functionName: props.agentActions.functionArn,
      principal: 'bedrock.amazonaws.com', sourceArn: agent.attrAgentArn, sourceAccount: account,
    })
    const alias = new bedrock.CfnAgentAlias(this, 'AgentAlias', { agentId: agent.attrAgentId, agentAliasName: 'live', description: 'Used by the dashboard' })

    // ── publish IDs for the Lambdas ──
    const param = (cid: string, name: string, value: string) => new ssm.StringParameter(this, cid, { parameterName: `/breatheiq/bedrock/${name}`, stringValue: value })
    param('GuardrailIdParam', 'guardrail-id', passenger.g.attrGuardrailId)
    param('GuardrailVersionParam', 'guardrail-version', passenger.version.attrVersion)
    param('AgentIdParam', 'agent-id', agent.attrAgentId)
    param('AgentAliasIdParam', 'agent-alias-id', alias.attrAgentAliasId)
    param('KbIdParam', 'kb-id', kb.attrKnowledgeBaseId)
    param('DataSourceIdParam', 'data-source-id', source.attrDataSourceId)

    new cdk.CfnOutput(this, 'KnowledgeBaseId', { value: kb.attrKnowledgeBaseId })
    new cdk.CfnOutput(this, 'DataSourceId', { value: source.attrDataSourceId })
    new cdk.CfnOutput(this, 'AgentId', { value: agent.attrAgentId })
    new cdk.CfnOutput(this, 'AgentAliasId', { value: alias.attrAgentAliasId })
    new cdk.CfnOutput(this, 'GuardrailId', { value: passenger.g.attrGuardrailId })
  }
}
