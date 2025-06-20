import { XPService } from './XPService';
export class TradingService {
  constructor(private xpService: XPService) {}
  async executeTrade(userId: number, asset: string): Promise<boolean> {
    // Simulate success
    await this.xpService.awardXP(userId, 'first_trade');
    return true;
  }
}
