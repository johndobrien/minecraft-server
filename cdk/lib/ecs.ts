import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Vpc, SecurityGroup, SubnetType, SubnetSelection } from 'aws-cdk-lib/aws-ec2';
import { Cluster, FargateTaskDefinition, FargateService, ContainerImage, AwsLogDriver, LogDriver, OperatingSystemFamily, CpuArchitecture, Protocol } from 'aws-cdk-lib/aws-ecs';
import { FileSystem, AccessPoint } from 'aws-cdk-lib/aws-efs';
import { Role, ServicePrincipal, PolicyDocument, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { getMinecraftEnvironemtnVairables } from './common';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';



export interface IECSResourcesProps {
  vpc: Vpc;
  securityGroup: SecurityGroup;
  serverSubDomain: string;
  domain: string;
  hostedZoneId: string;
  memorySize: string;
  cpuSize: string;
  snsTopic: Topic;
  startupMin: string;
  shutdownMin: string;
  serverPort: number;
  serverDebug: boolean;
  subDomainHostedZoneId: string;
  enablePersistence: boolean;
}

export interface IECSResources {
  task: FargateTaskDefinition;
  cluster: Cluster;
  service: FargateService;
}

export function createECSResources(scope: Construct, id: string, props: IECSResourcesProps): any {
  // Create ECS Cluster
  const clusterId = `${id}-Cluster`;

  const cluster = new Cluster(scope, clusterId, {
    vpc: props.vpc,
    clusterName: clusterId,
    containerInsights: true,
    enableFargateCapacityProviders: true,
  });

  // EFS resources
  let fileSystem: FileSystem | undefined;
  let accessPoint: AccessPoint | undefined;

  if (props.enablePersistence) {
    const fsId = `${id}-FileSystem`;
    fileSystem = new FileSystem(scope, fsId, {
      vpc: props.vpc,
      fileSystemName: fsId,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const accessPointId = `${id}-AccessPoint`;
    accessPoint = new AccessPoint(scope, accessPointId, {
      fileSystem,
      path: '/minecraft',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '0750',
      },
    });
  }
  
  // IAM Role for ECS Tasks
  const taskRoleId = `${id}-TaskRole`;
  const taskRole = new Role(scope, taskRoleId, {
    roleName: taskRoleId,
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    inlinePolicies: {
      TaskPolicy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              'elasticfilesystem:ClientMount',
              'elasticfilesystem:ClientWrite',
              'elasticfilesystem:DescribeFileSystems',
              'ecs:DescribeTasks',
            ],
            resources: ['*'],
          }),
        ],
      }),
    },
  });

  var mincreaftEnvVars = getMinecraftEnvironemtnVairables();
  

  // Main Server Container Definition
  const containerId = `${id}-ServerContainer`;

  var dockerImage = new DockerImageAsset(scope, `${id}-DockerImage`, {
    directory: "../",
  });
  // Logging
  let loggingDriver: LogDriver | undefined;
  if (props.serverDebug) {
    const logPrefix = `${id}-Log`;
    loggingDriver = new AwsLogDriver({
      logRetention: RetentionDays.THREE_DAYS,
      streamPrefix: logPrefix,
    });
  }

  const containerImage = ContainerImage.fromDockerImageAsset(dockerImage);
  
  // Fargate Task Definition
  const taskDefId = `${id}-TaskDefinition`;
  const taskDef = new FargateTaskDefinition(scope, taskDefId, {
    memoryLimitMiB: parseFloat(props.memorySize),
    cpu: parseFloat(props.cpuSize),
    taskRole,
  });

  const serverContainer = taskDef.addContainer(containerId, {
    image: containerImage,
    environment: {
      EULA: 'TRUE',
      ...mincreaftEnvVars,
    },
    portMappings: [
      {
        containerPort: props.serverPort,
        hostPort: props.serverPort,
        protocol: Protocol.TCP,
      },
    ],
    memoryReservationMiB: 6144,
    logging: loggingDriver,
  });

  // Fargate Service
  const serviceId = `${id}-FargateService`;
  const service = new FargateService(scope, serviceId, {
    serviceName: serviceId,
    cluster,
    capacityProviderStrategies: [
      {
        capacityProvider: 'FARGATE',
        weight: 1,
        base: 1,
      },
    ],
    taskDefinition: taskDef,
    assignPublicIp: true,
    desiredCount: 0,
    vpcSubnets: { subnetType: SubnetType.PUBLIC } as SubnetSelection,
    securityGroups: [props.securityGroup],
    enableExecuteCommand: true,
  });

  if (props.enablePersistence && fileSystem && accessPoint) {
    const volumeId = `${id}-DataVolume`;
    taskDef.addVolume({
      name: volumeId,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    serverContainer.addMountPoints({
      containerPath: '/data',
      sourceVolume: volumeId,
      readOnly: false,
    });

    fileSystem.connections.allowDefaultPortFrom(service, 'Allow ECS service to access EFS');
  }
  
  // Add Watchdog Container
  const watchdogContainerId = `${id}-WatchdogContainer`;
  taskDef.addContainer(watchdogContainerId, {
    image: ContainerImage.fromAsset('./src/watchdog', { file: 'Dockerfile' }),
    essential: true,
    environment: {
      CLUSTER: cluster.clusterName,
      SERVICE: serviceId,
      DNSZONE: props.subDomainHostedZoneId,
      SERVERNAME: `${props.serverSubDomain}.${props.domain}`,
      SNSTOPIC: props.snsTopic.topicArn,
      STARTUPMIN: props.startupMin,
      SHUTDOWNMIN: props.shutdownMin,
    },
    memoryReservationMiB: 64,
    logging: loggingDriver,
  });

  // IAM Policies for Watchdog
  const policyId = `${id}-ServerPolicy`;
  const serverPolicy = new Policy(scope, policyId, {
    policyName: policyId,
    statements: [
      new PolicyStatement({
        actions: ['ecs:*'],
        resources: [
          taskDef.taskDefinitionArn,
          `${taskDef.taskDefinitionArn}/*`,
          service.serviceArn,
          `${service.serviceArn}/*`,
          cluster.clusterArn,
          `${cluster.clusterArn}/*`,
        ],
      }),
      new PolicyStatement({
        actions: ['ec2:DescribeNetworkInterfaces'],
        resources: ['*'],
      }),
      new PolicyStatement({
        actions: ['sns:Publish'],
        resources: [props.snsTopic.topicArn],
      }),
      new PolicyStatement({
        actions: ['route53:GetHostedZone', 'route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets'],
        resources: [`arn:aws:route53:::hostedzone/${props.subDomainHostedZoneId}`],
      }),
    ],
  });
  serverPolicy.attachToRole(taskRole);

  return {
    taskDef,
    cluster,
    service,
  };
}