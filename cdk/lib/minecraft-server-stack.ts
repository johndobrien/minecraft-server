import { SNSResources } from "./sns";
import { createECSResources } from "./ecs";
import { Stack, StackProps, App } from "aws-cdk-lib";
import { getEnvOrDefault, getRequiredEnv,} from "./common";
import { VPCResources } from "./vpc";
import { Route53Resources } from "./route53";
import { Port } from "aws-cdk-lib/aws-ec2";
import { LambdaResources } from "./lambda";


// Define ServerConfig interface
export interface IServerConfig {
  port: number;
  debug: boolean;
  ingressPort: Port; // Placeholder, should be ec2.Port
}

export interface IMinecraftServerStackProps extends StackProps {
  usEastLogGroupArn: string;
  ecsCpuSize: string;
  ecsDebug: string;
  ecsMemorySize: string;
  ecsShutdownMin: string;
  ecsStartupMin: string;
  route53Domain: string;
  route53HostedZoneId: string;
  route53ServerSubDomain: string;
  snsEmail: string;
  ecsEnablePersistence: boolean;
  minecraftServerConfig: IServerConfig;
}

// Configure server based on edition
function configureServer(debug: string): IServerConfig {
  let port = 25565;
  let image = "itzg/minecraft-server";
  return {
    port: port,
    debug: debug === "true",
    ingressPort: Port.tcp(port),
  };
}

// Parse env vars to stack props
export function getStackProps(): IMinecraftServerStackProps {
  return {
    env: {
      account: getRequiredEnv("AWS_DESTINATION_ACCOUNT"),
      region: getRequiredEnv("AWS_DESTINATION_REGION"),
    },
    route53ServerSubDomain: getRequiredEnv("ROUTE53_SERVER_SUBDOMAIN"),
    route53Domain: getRequiredEnv("ROUTE53_DOMAIN"),
    route53HostedZoneId: getRequiredEnv("ROUTE53_HOSTED_ZONE_ID"),
    ecsMemorySize: getEnvOrDefault("ECS_MEMORY_SIZE", "8192"),
    ecsCpuSize: getEnvOrDefault("ECS_CPU_SIZE", "4096"),
    snsEmail: getRequiredEnv("SNS_EMAIL"),
    ecsStartupMin: getEnvOrDefault("ECS_STARTUP_MIN", "10"),
    ecsShutdownMin: getEnvOrDefault("ECS_SHUTDOWN_MIN", "20"),
    ecsDebug: getEnvOrDefault("ECS_DEBUG", "false"),
    ecsEnablePersistence: getEnvOrDefault("ECS_ENABLE_PERSISTENCE", "false") === "true",
    minecraftServerConfig: configureServer(
      getEnvOrDefault("ECS_DEBUG", "false")
    ),
    usEastLogGroupArn: "", // Will be set later
  };
}

export class MinecraftServerStatck extends Stack {
  constructor(scope: App, id: string, props: IMinecraftServerStackProps) {
    super(scope, id, props);

    const vpcResources = new VPCResources(this, `${id}-VPC`, {
      ingressPort: props.minecraftServerConfig.ingressPort,
    });
    
    const snsResources = new SNSResources(this, `${id}-SNS`, {
      snsEmail: props.snsEmail,
    });

    const route53Resources = new Route53Resources(this, `${id}-Route53`, {
      domain: props.route53Domain,
      hostedZoneId: props.route53HostedZoneId,
      serverSubDomain: props.route53ServerSubDomain,
      usEast1LogGroupArn: props.usEastLogGroupArn,
    });

    const ecsResources = createECSResources(this, `${id}-ECS`, {
      cpuSize: props.ecsCpuSize,
      domain: props.route53Domain,
      enablePersistence: props.ecsEnablePersistence,
      hostedZoneId: props.route53HostedZoneId,
      memorySize: props.ecsMemorySize,
      serverDebug: props.minecraftServerConfig.debug,
      serverPort: props.minecraftServerConfig.port,
      serverSubDomain: props.route53ServerSubDomain,
      shutdownMin: props.ecsShutdownMin,
      snsTopic: snsResources.snsTopic,
      startupMin: props.ecsStartupMin,
      subDomainHostedZoneId: route53Resources.subDomainZoneId,
      vpc: vpcResources.vpc,
      securityGroup: vpcResources.securityGroup,
    });

    new LambdaResources(this, `${id}-Lambda`, {
      queryLogGroup:   route53Resources.queryLogGroup,
		  cluster:         ecsResources.cluster,
		  service:         ecsResources.service,
		  serverSubDomain: props.route53ServerSubDomain,
		  domain:          props.route53Domain,
    });
  }
}
