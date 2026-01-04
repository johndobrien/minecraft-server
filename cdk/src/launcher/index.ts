import { ECSClient, DescribeServicesCommand, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { Handler, Context } from "aws-lambda";

const REGION = process.env.REGION!;
const CLUSTER = process.env.CLUSTER!;
const SERVICE = process.env.SERVICE!;

if (!REGION || !CLUSTER || !SERVICE) {
  throw new Error("Missing required environment variables: REGION, CLUSTER, SERVICE");
}

const ecsClient = new ECSClient({ region: REGION });

export const handler: Handler = async (event: any, context: Context) => {
  // Describe ECS service
  let describeOutput;
  try {
    describeOutput = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: CLUSTER,
        services: [SERVICE],
      })
    );
  } catch (err) {
    console.error("Failed to describe ECS service", { error: err });
    throw err;
  }

  if (!describeOutput.services || describeOutput.services.length === 0) {
    console.error("No services found", { cluster: CLUSTER, service: SERVICE });
    throw new Error("No ECS services found");
  }

  const desiredCount = describeOutput.services[0].desiredCount ?? 0;
  console.info("Current desired count", { desiredCount });

  // Update desired count if it's 0
  if (desiredCount === 0) {
    try {
      await ecsClient.send(
        new UpdateServiceCommand({
          cluster: CLUSTER,
          service: SERVICE,
          desiredCount: 1,
        })
      );
      console.info("Updated desiredCount to 1");
    } catch (err) {
      console.error("Failed to update ECS service desired count", { error: err });
      throw err;
    }
  } else {
    console.info("desiredCount already at 1");
  }

  return;
};