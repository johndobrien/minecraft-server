import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction, Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays, FilterPattern, ResourcePolicy } from 'aws-cdk-lib/aws-logs';
import { LambdaDestination } from 'aws-cdk-lib/aws-logs-destinations';

export interface IQueryLogStackProps extends StackProps {
  serverSubDomain: string;
  domain: string;
  destinationAccountId: string;
  destinationRegion: string;
}

export class QueryLogStack extends Stack {
  public readonly queryLogGroup: LogGroup;

  constructor(scope: Construct, id: string, props: IQueryLogStackProps) {
    super(scope, id, props);

    // Create the log group for Route53 query logs in `us-east-1`
    const logGroupName = `/aws/route53/${props.serverSubDomain}.${props.domain}`;
    const queryLogGroupId = `${id}-QueryLogGroup`;
    this.queryLogGroup = new LogGroup(this, queryLogGroupId, {
      logGroupName,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create resource policy for allowing Route53 to log to CloudWatch
    const resourcePolicyId = `${id}-ResourcePolicy`;
    new ResourcePolicy(this, resourcePolicyId, {
      resourcePolicyName: resourcePolicyId,
      policyStatements: [
        new PolicyStatement({
          principals: [new ServicePrincipal('route53.amazonaws.com')],
          actions: [
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogStreams',
            'logs:CreateLogGroup',
          ],
          resources: [`${this.queryLogGroup.logGroupArn}:*`],
        }),
      ],
    });

    // IAM Role for Lambda to forward logs
    const lambdaRoleId = `${id}-LogForwarderRole`;
    const lambdaRole = new Role(this, lambdaRoleId, {
      roleName: lambdaRoleId,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        AllowLogForwarding: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['logs:PutLogEvents', 'logs:CreateLogStream'],
              resources: [
                `arn:aws:logs:${props.destinationRegion}:${props.destinationAccountId}:log-group:${logGroupName}:*`,
              ],
            }),
          ],
        }),
      },
    });

    // Create Lambda function to forward logs
    const logForwarderLambdaId = `${id}-LogForwarderLambda`;
    const logForwarderLambda = new LambdaFunction(this, logForwarderLambdaId, {
      functionName: logForwarderLambdaId,
      code: LambdaFunction.fromAsset('cmd/lambda/logforwarder'),
      role: lambdaRole,
      handler: 'bootstrap',
      runtime: Runtime.PROVIDED_AL2023,
      architecture: Architecture.ARM_64,
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        TARGET_LOG_GROUP_ARN: `arn:aws:logs:${props.destinationRegion}:${props.destinationAccountId}:log-group:${logGroupName}:*`,
        TARGET_LOG_GROUP_NAME: this.queryLogGroup.logGroupName,
      },
    });

    // Add CloudWatch Logs subscription filter
    const subscriptionFilterId = `${id}-SubscriptionFilter`;
    this.queryLogGroup.addSubscriptionFilter(subscriptionFilterId, {
      destination: new LambdaDestination(logForwarderLambda),
      filterPattern: FilterPattern.allTerms(`${props.serverSubDomain}.${props.domain}`),
    });
  }
}