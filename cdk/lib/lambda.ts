import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { Cluster, FargateService } from 'aws-cdk-lib/aws-ecs';
import { Role, ServicePrincipal, PolicyDocument, PolicyStatement, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays, FilterPattern } from 'aws-cdk-lib/aws-logs';
import { LambdaDestination, LambdaDestinationOptions } from 'aws-cdk-lib/aws-logs-destinations';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface LambdaResourcesProps {
  queryLogGroup: LogGroup;
  cluster: Cluster;
  service: FargateService;
  serverSubDomain: string;
  domain: string;
}

export class LambdaResources extends Construct {
  constructor(scope: Construct, id: string, props: LambdaResourcesProps) {
    super(scope, id);

    // Create IAM Role for the Lambda function
    const lambdaRole = new Role(this, `${id}-LambdaRole`, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ecsPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              resources: [
                `${props.service.serviceArn}/*`,
                props.service.serviceArn,
                `${props.cluster.clusterArn}/*`,
                props.cluster.clusterArn,
              ],
              actions: ['ecs:*'],
            }),
          ],
        }),
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    
    // Create Lambda function using the PROVIDED_AL2023 runtime and ARM_64 architecture
    const launcherLambda = new NodejsFunction(this, `${id}-LauncherLambda`, {
      functionName: `${id}-LauncherLambda`,
      entry: path.join(__dirname, '../lambda/launcher/index.ts'),
      role: lambdaRole,
      handler: 'handler',
      logRetention: RetentionDays.FIVE_DAYS,
      environment: {
        REGION: Stack.of(this).region,
        CLUSTER: props.cluster.clusterName,
        SERVICE: props.service.serviceName,
      },
    });

    // Add permissions for CloudWatch Logs to invoke Lambda
    launcherLambda.addPermission('InvokeLambda', {
      principal: new ServicePrincipal(`logs.${Stack.of(this).region}.amazonaws.com`),
      action: 'lambda:InvokeFunction',
      sourceArn: props.queryLogGroup.logGroupArn,
      sourceAccount: Stack.of(this).account,
    });

    // Add CloudWatch Logs subscription filter
    props.queryLogGroup.addSubscriptionFilter(`${id}-SubscriptionFilter`, {
      destination: new LambdaDestination(launcherLambda, {} as LambdaDestinationOptions),
      filterPattern: FilterPattern.allTerms(`${props.serverSubDomain}.${props.domain}`),
    });
  }
}