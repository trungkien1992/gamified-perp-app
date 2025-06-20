export class NotificationService {
  private static instance: NotificationService;
  private constructor() {}

  static getInstance(): NotificationService {
    if (!this.instance) {
      this.instance = new NotificationService();
    }
    return this.instance;
  }

  async sendPushNotification(userId: number, payload: any): Promise<void> {
    // TODO: Implement push notification logic
    return;
  }
} 