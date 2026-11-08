/**
 * Caso de uso: cotizar un pago on-ramp (fiat → cripto).
 *
 * Orquesta la obtención de una cotización vía el proveedor de rampas.
 * No depende de @pollar/core ni de child_process; solo depende del puerto FiatRampProvider.
 */
import { FiatRampProvider } from '../../application/ports/FiatRampProvider';

export class CreateOnRampQuote {
  constructor(private readonly fiatRampProvider: FiatRampProvider) {}

  async execute(params: {
    direction: 'on' | 'off';
    fiat: { currency: string; rail?: string; country?: string };
    asset: { code: string; identifier?: string | null; chain: 'STELLAR' | 'POLYGON' | 'SOLANA' };
    amount: { value: string; denomination: 'in' | 'out' };
  }): Promise<import('../../application/ports/FiatRampProvider').RampQuote> {
    if (!params.amount || !params.amount.value || !params.amount.denomination) {
      throw new Error('amount.value y amount.denomination son requeridos');
    }

    return this.fiatRampProvider.quoteRamp(params);
  }
}
