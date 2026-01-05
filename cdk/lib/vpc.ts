import { Construct } from 'constructs';
import { Vpc, SubnetType, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';

export interface IVPCResourcesProps {
  ingressPort: Port;
}

export class VPCResources extends Construct {
  public readonly securityGroup: SecurityGroup;
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: IVPCResourcesProps) {
    super(scope, id);

    // Create VPC
    const vpcId = `${id}-VPC`;
    this.vpc = new Vpc(this, vpcId, {
      vpcName: vpcId,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${id}-PublicSubnet`,
          subnetType: SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
        },
      ],
      maxAzs: 2,
    });

    // Create Security Group
    const sgId = `${id}-SecurityGroup`;
    this.securityGroup = new SecurityGroup(this, sgId, {
      vpc: this.vpc,
      securityGroupName: sgId,
      description: 'Security Group for server',
      allowAllOutbound: true,
    });

    // Add ingress rule
    this.securityGroup.addIngressRule(
      Peer.anyIpv4(),
      props.ingressPort,
      `${id}-AllowServerTraffic`,
      false
    );
  }
}