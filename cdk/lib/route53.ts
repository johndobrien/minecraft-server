import { Construct } from 'constructs';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays, ResourcePolicy } from 'aws-cdk-lib/aws-logs';
import { HostedZone, NsRecord, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';

export interface IRoute53ResourcesProps {
  serverSubDomain: string;
  domain: string;
  hostedZoneId: string;
  usEast1LogGroupArn: string;
}

export class Route53Resources extends Construct {
  public readonly queryLogGroup: LogGroup;
  public readonly subDomainZoneId: string;

  constructor(scope: Construct, id: string, props: IRoute53ResourcesProps) {
    super(scope, id);

    // Create the log group for Route53 query logs
    const logGroupName = `/aws/route53/${props.serverSubDomain}.${props.domain}`;
    this.queryLogGroup = new LogGroup(this, `${id}-QueryLogGroup`, {
      logGroupName,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Update the resource policy to allow Route 53 to write to the log group in us-east-1
    const resourcePolicyName = `${id}-Route53ResourcePolicy`;
    new ResourcePolicy(this, resourcePolicyName, {
      resourcePolicyName,
      policyStatements: [
        new PolicyStatement({
          principals: [new ServicePrincipal('route53.amazonaws.com')],
          actions: [
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogStreams',
            'logs:CreateLogGroup',
          ],
          resources: [`${props.usEast1LogGroupArn}:*`],
        }),
      ],
    });

    // Reference the hosted zone
    const hostedZone = HostedZone.fromHostedZoneAttributes(this, `${id}-HostedZone`, {
      zoneName: props.domain,
      hostedZoneId: props.hostedZoneId,
    });

    // Create a hosted zone for the subdomain
    const subdomainHostedZoneName = `${id}-SubdomainHostedZone`;
    const subdomainHostedZone = new HostedZone(this, subdomainHostedZoneName, {
      zoneName: `${props.serverSubDomain}.${props.domain}`,
      queryLogsLogGroupArn: props.usEast1LogGroupArn,
    });

    // Create the NS record for the subdomain
    const nsRecordName = `${id}-SubdomainNsRecord`;
    new NsRecord(this, nsRecordName, {
      zone: hostedZone,
      values: subdomainHostedZone.hostedZoneNameServers!,
      recordName: `${props.serverSubDomain}.${props.domain}`,
    });

    // Create an A record for the subdomain
    const aRecordName = `${id}-ARecord`;
    new ARecord(this, aRecordName, {
      zone: subdomainHostedZone,
      target: RecordTarget.fromIpAddresses('192.168.1.1'),
      ttl: Duration.seconds(30),
      recordName: `${props.serverSubDomain}.${props.domain}`,
    });

    this.subDomainZoneId = subdomainHostedZone.hostedZoneId;
  }
}