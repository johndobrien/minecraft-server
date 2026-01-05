import { EC2Client, DescribeNetworkInterfacesCommand } from "@aws-sdk/client-ec2";
import { ECSClient, DescribeTasksCommand, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { Route53Client, ChangeResourceRecordSetsCommand } from "@aws-sdk/client-route-53";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import * as http from "http";
import * as os from "os";
import * as net from "net";
import * as dgram from "dgram";
import * as crypto from "crypto";

// Constants
const javaPort = 25565;
const rconPort = 25575;
const bedrockPort = 19132;
const bedrockIP = "127.0.0.1";
const bedrockPingWait = 1000;
const checkInterval = 60 * 1000;
const rconWaitInterval = 1000;
const maxStartupWait = 10 * 60 * 1000;

// Config type
interface Config {
  Cluster: string;
  Service: string;
  ServerName: string;
  DNSZone: string;
  SNSTopic?: string;
  StartupMin: number;
  ShutdownMin: number;
}

// Helper to get env vars
function getEnv(name: string, required = false, def?: string): string {
  const val = process.env[name] || def;
  if (required && !val) throw new Error(`${name} is required`);
  return val!;
}

// Main
async function main() {
  const cfg: Config = {
    Cluster: getEnv("CLUSTER", true),
    Service: getEnv("SERVICE", true),
    ServerName: getEnv("SERVERNAME", true),
    DNSZone: getEnv("DNSZONE", true),
    SNSTopic: getEnv("SNSTOPIC"),
    StartupMin: parseInt(getEnv("STARTUPMIN", false, "10")!),
    ShutdownMin: parseInt(getEnv("SHUTDOWNMIN", false, "20")!),
  };

  const ecsClient = new ECSClient({});
  const ec2Client = new EC2Client({});
  const route53Client = new Route53Client({});
  const snsClient = new SNSClient({});

  const taskID = await fetchTaskID();
  const publicIP = await resolvePublicIP(ecsClient, ec2Client, cfg, taskID);
  await updateDNSRecord(route53Client, cfg, publicIP);

  const edition = await determineEdition();
  await sendStartupNotification(snsClient, cfg, edition, publicIP);

  if (await waitForInitialClientConnection(cfg, edition)) {
    await monitorClientConnections(ecsClient, snsClient, cfg, edition);
  } else {
    await shutdownService(ecsClient, snsClient, cfg);
    process.exit(1);
  }
}

async function fetchTaskID(): Promise<string> {
  const metaUrl = process.env["ECS_CONTAINER_METADATA_URI_V4"] + "/task";
  return new Promise((resolve, reject) => {
    http.get(metaUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const result = JSON.parse(data);
        if (result.TaskARN) resolve(result.TaskARN);
        else reject("TaskARN not found");
      });
    }).on("error", reject);
  });
}

async function resolvePublicIP(
  ecsClient: ECSClient,
  ec2Client: EC2Client,
  cfg: Config,
  taskID: string
): Promise<string> {
  const ecsResp = await ecsClient.send(
    new DescribeTasksCommand({ cluster: cfg.Cluster, tasks: [taskID] })
  );
  const eni = ecsResp.tasks?.[0]?.attachments?.[0]?.details?.find(
    (d) => d.name === "networkInterfaceId"
  )?.value;
  if (!eni) throw new Error("ENI not found");
  const ec2Resp = await ec2Client.send(
    new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eni] })
  );
  return ec2Resp.NetworkInterfaces?.[0]?.Association?.PublicIp!;
}

async function updateDNSRecord(
  client: Route53Client,
  cfg: Config,
  publicIP: string
) {
  await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: cfg.DNSZone,
      ChangeBatch: {
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: cfg.ServerName,
              Type: "A",
              TTL: 30,
              ResourceRecords: [{ Value: publicIP }],
            },
          },
        ],
      },
    })
  );
}

async function determineEdition(): Promise<string> {
  let counter = 0;
  while (true) {
    if (await isPortOpenAndListening(javaPort)) {
      await waitForRCON();
      return "java";
    }
    if (await isPortOpen(bedrockPort)) {
      return "bedrock";
    }
    await new Promise((r) => setTimeout(r, 1000));
    counter++;
    if (counter > maxStartupWait / 1000) throw new Error("Timeout waiting for server");
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  // TODO: Implement using Node.js net or a library like node-netstat
  return false;
}

async function isPortOpenAndListening(port: number): Promise<boolean> {
  // TODO: Implement using Node.js net or a library like node-netstat
  return false;
}

async function waitForRCON() {
  // TODO: Implement RCON port check
}

async function waitForInitialClientConnection(cfg: Config, edition: string): Promise<boolean> {
  for (let counter = 0; counter < cfg.StartupMin; counter++) {
    if (await isConnected(edition)) return true;
    await new Promise((r) => setTimeout(r, checkInterval));
  }
  return false;
}

async function isConnected(edition: string): Promise<boolean> {
  if (edition === "java") {
    // TODO: Implement checkConnections(javaPort)
    return false;
  }
  // TODO: Implement sendBedrockPing
  return false;
}

async function monitorClientConnections(
  ecsClient: ECSClient,
  snsClient: SNSClient,
  cfg: Config,
  edition: string
) {
  let counter = 0;
  while (counter <= cfg.ShutdownMin) {
    if (!(await isConnected(edition))) {
      counter++;
    } else {
      counter = 0;
    }
    await new Promise((r) => setTimeout(r, checkInterval));
  }
  await shutdownService(ecsClient, snsClient, cfg);
}

async function shutdownService(
  ecsClient: ECSClient,
  snsClient: SNSClient,
  cfg: Config
) {
  await sendShutdownNotification(snsClient, cfg);
  await ecsClient.send(
    new UpdateServiceCommand({
      cluster: cfg.Cluster,
      service: cfg.Service,
      desiredCount: 0,
    })
  );
}

async function sendStartupNotification(
  client: SNSClient,
  cfg: Config,
  edition: string,
  publicIP: string
) {
  if (!cfg.SNSTopic) return;
  const message = `Server is online.\nService: ${cfg.Service}\nEdition: ${edition}\nAddress: ${cfg.ServerName} (${publicIP})\nCluster: ${cfg.Cluster}\nTime: ${new Date().toUTCString()}`;
  await client.send(
    new PublishCommand({
      TopicArn: cfg.SNSTopic,
      Message: message,
    })
  );
}

async function sendShutdownNotification(client: SNSClient, cfg: Config) {
  if (!cfg.SNSTopic) return;
  const message = `Shutting down server.\nService: ${cfg.Service}\nAddress: ${cfg.ServerName}\nCluster: ${cfg.Cluster}\nTime: ${new Date().toUTCString()}`;
  await client.send(
    new PublishCommand({
      TopicArn: cfg.SNSTopic,
      Message: message,
    })
  );
}

// Start the main function
main().catch((err) => {
  console.error(err);
  process.exit(1);
});