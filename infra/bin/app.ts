#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { CoreStack } from '../lib/core-stack'
import { BedrockStack } from '../lib/bedrock-stack'
import { WebStack } from '../lib/web-stack'

const app = new cdk.App()
const ctx = (key: string, fallback: string) => (app.node.tryGetContext(key) as string | undefined) ?? fallback
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region', 'us-east-1') }

// Model IDs are configuration, confirmed against `aws bedrock list-inference-profiles` for this
// account before deploying. Override with `-c fastModel=… -c strongModel=… -c agentModel=…`.
const fastModel = ctx('fastModel', 'us.anthropic.claude-haiku-5-5')
const strongModel = ctx('strongModel', 'us.anthropic.claude-sonnet-5-5')

const core = new CoreStack(app, 'BreatheiqCore', {
  env, description: 'BreatheIQ: IoT pipeline, model serving, Bad Day playbook, API and auth',
  fastModel, strongModel, smInstance: ctx('smInstance', 'ml.m5.large'),
})

new WebStack(app, 'BreatheiqWeb', {
  env, description: 'BreatheIQ: Amplify Hosting, CloudWatch dashboard and alarms, budget',
  fns: core.fns, stateMachine: core.stateMachine, staffTopic: core.staffTopic,
  monthlyBudgetUsd: Number(ctx('monthlyBudgetUsd', '20')),
})

new BedrockStack(app, 'BreatheiqBedrock', {
  env, description: 'BreatheIQ: Bedrock Guardrails, Knowledge Base (S3 Vectors) and the Ask BreatheIQ agent',
  dataBucket: core.dataBucket, agentActions: core.fns.agentActions,
  agentModel: ctx('agentModel', strongModel), embeddingModel: ctx('embeddingModel', 'amazon.titan-embed-text-v2:0'),
})

cdk.Tags.of(app).add('project', 'breatheiq')
