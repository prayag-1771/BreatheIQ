import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {
  aws_amplify as amplify, aws_budgets as budgets, aws_cloudwatch as cw, aws_cloudwatch_actions as cwActions,
  aws_iam as iam, aws_lambda as lambda, aws_logs as logs, aws_sns as sns, aws_stepfunctions as sfn,
} from 'aws-cdk-lib'

export interface WebProps extends cdk.StackProps {
  fns: Record<string, lambda.Function>
  stateMachine: sfn.StateMachine
  staffTopic: sns.Topic
  monthlyBudgetUsd: number
}

/** Amplify Hosting for the dashboard, the CloudWatch dashboard and alarms, and the cost budget. */
export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id, props)
    const { fns, stateMachine, staffTopic } = props

    // ── Amplify Hosting (manual deployments: scripts/post-deploy.mjs uploads the build) ──
    const app = new amplify.CfnApp(this, 'Dashboard', {
      name: 'breatheiq', platform: 'WEB', description: 'BreatheIQ dashboard',
      customHeaders: [
        'customHeaders:',
        '  - pattern: "/assets/*"',
        '    headers:',
        '      - key: Cache-Control',
        '        value: "public, max-age=31536000, immutable"',
        '  - pattern: "**/*.mjs"',
        '    headers:',
        '      - key: Content-Type',
        '        value: "text/javascript"',
        '  - pattern: "/aws-config.json"',
        '    headers:',
        '      - key: Cache-Control',
        '        value: "no-cache"',
      ].join('\n'),
    })
    const branch = new amplify.CfnBranch(this, 'Main', { appId: app.attrAppId, branchName: 'main', stage: 'PRODUCTION', enableAutoBuild: false })

    // ── Bedrock call metrics from the structured log lines ──
    const NS = 'BreatheIQ'
    for (const key of ['api', 'chat', 'playbook']) {
      const group = fns[key].logGroup
      const filter = (name: string, metricValue: string) =>
        new logs.MetricFilter(this, `${key}${name}`, {
          logGroup: group, metricNamespace: NS, metricName: name, metricValue,
          filterPattern: logs.FilterPattern.stringValue('$.metric', '=', 'bedrock'),
        })
      filter('BedrockRequests', '1')
      filter('BedrockAnswered', '$.ok')
      filter('BedrockLatencyMs', '$.latencyMs')
      filter('BedrockOutputTokens', '$.outputTokens')
    }
    const custom = (metricName: string, statistic: string) => new cw.Metric({ namespace: NS, metricName, statistic, period: cdk.Duration.minutes(5) })

    // ── alarms ──
    const notify = new cwActions.SnsAction(staffTopic)
    const alarm = (aid: string, metric: cw.IMetric, threshold: number, description: string, op = cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, missing = cw.TreatMissingData.NOT_BREACHING) => {
      const a = new cw.Alarm(this, aid, { alarmName: `breatheiq-${aid}`, alarmDescription: description, metric, threshold, evaluationPeriods: 1, comparisonOperator: op, treatMissingData: missing })
      a.addAlarmAction(notify)
      return a
    }
    const five = { period: cdk.Duration.minutes(5) }
    const alarms = [
      alarm('process-frame-errors', fns.process.metricErrors({ ...five, statistic: 'Sum' }), 5, 'The frame processor is failing: telemetry is not reaching DynamoDB or the coach.'),
      alarm('inference-slow', fns.inference.metricDuration({ ...five, statistic: 'p90' }), 3000, 'Model inference p90 is above 3 s.'),
      alarm('playbook-failed', stateMachine.metricFailed({ ...five, statistic: 'Sum' }), 1, 'A Bad Day playbook execution failed.'),
      alarm('telemetry-silent', fns.process.metricInvocations({ period: cdk.Duration.minutes(10), statistic: 'Sum' }), 1, 'No telemetry for 10 minutes (simulator paused or device offline).', cw.ComparisonOperator.LESS_THAN_THRESHOLD, cw.TreatMissingData.BREACHING),
    ]

    // ── CloudWatch dashboard ──
    const iotIn = new cw.MathExpression({
      expression: `SUM(SEARCH('{AWS/IoT,Protocol} MetricName="PublishIn.Success"', 'Sum', 60))`, label: 'IoT messages in', period: cdk.Duration.minutes(1),
    })
    const board = new cw.Dashboard(this, 'Board', { dashboardName: 'breatheiq', defaultInterval: cdk.Duration.hours(3) })
    const g = (title: string, left: cw.IMetric[], right: cw.IMetric[] = []) => new cw.GraphWidget({ title, left, right, width: 8, height: 6 })
    board.addWidgets(
      g('IoT Core · frames per minute', [iotIn, fns.process.metricInvocations({ period: cdk.Duration.minutes(1), statistic: 'Sum', label: 'process-frame invocations' })]),
      g('Lambda latency (ms)', [fns.process.metricDuration({ statistic: 'p50', label: 'process-frame p50' }), fns.process.metricDuration({ statistic: 'p90', label: 'process-frame p90' }), fns.inference.metricDuration({ statistic: 'p50', label: 'rf-inference p50' })]),
      g('Lambda errors', Object.values(fns).map((f) => f.metricErrors({ statistic: 'Sum', label: f.node.id }))),
    )
    board.addWidgets(
      g('Bedrock · latency and tokens', [custom('BedrockLatencyMs', 'Average')], [custom('BedrockOutputTokens', 'Sum')]),
      g('Bedrock · requests vs answered by a model', [custom('BedrockRequests', 'Sum'), custom('BedrockAnswered', 'Sum')]),
      g('Step Functions · Bad Day playbook', [stateMachine.metricStarted({ statistic: 'Sum' }), stateMachine.metricSucceeded({ statistic: 'Sum' }), stateMachine.metricFailed({ statistic: 'Sum' })]),
    )
    board.addWidgets(new cw.AlarmStatusWidget({ title: 'Alarms', alarms, width: 24, height: 3 }))

    // ── AWS Budgets: alert before the bill can surprise anyone ──
    staffTopic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'], principals: [new iam.ServicePrincipal('budgets.amazonaws.com')], resources: [staffTopic.topicArn],
    }))
    const subscribers = [{ subscriptionType: 'SNS', address: staffTopic.topicArn }]
    new budgets.CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'breatheiq-monthly', budgetType: 'COST', timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
        // count usage before promotional credits, so the alert fires while credits are still paying
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [
        { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 50, thresholdType: 'PERCENTAGE' }, subscribers },
        { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers },
        { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers },
      ],
    })

    new cdk.CfnOutput(this, 'AmplifyAppId', { value: app.attrAppId })
    new cdk.CfnOutput(this, 'AmplifyBranch', { value: branch.branchName })
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${branch.branchName}.${app.attrDefaultDomain}` })
    new cdk.CfnOutput(this, 'CloudWatchDashboard', { value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=breatheiq` })
  }
}
