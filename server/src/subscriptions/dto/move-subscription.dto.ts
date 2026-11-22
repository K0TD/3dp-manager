import { IsIn, IsUUID } from 'class-validator';

export class MoveSubscriptionDto {
  @IsUUID()
  subscriptionId: string;

  @IsUUID()
  neighborId: string;

  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
