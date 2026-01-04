import { Construct } from 'constructs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription, EmailSubscriptionProps } from 'aws-cdk-lib/aws-sns-subscriptions';

export interface SNSResourcesProps {
  snsEmail: string;
}

export class SNSResources extends Construct {
  public readonly snsTopic: Topic;

  constructor(scope: Construct, id: string, props: SNSResourcesProps) {
    super(scope, id);

    const snsTopicId = `${id}-SnsTopic`;
    this.snsTopic = new Topic(this, snsTopicId, {
      topicName: snsTopicId,
    });

    const emailSubscription = new EmailSubscription(props.snsEmail, {} as EmailSubscriptionProps);
    this.snsTopic.addSubscription(emailSubscription);
  }
}