/**
 * Caso de uso: crear una orden de rampa a partir de una cotización.
 *
 * Orquesta la creación de una orden de on/off-ramp vía el proveedor.
 * No depende de @pollar/core ni de child_process; solo depende del puerto FiatRampProvider.
 */
export class ExecuteOnRampOrder {
  constructor(private readonly fiatRampProvider: import('../../application/ports/FiatRampProvider').FiatRampProvider) {}

  async execute(params: {
    quoteId: string;
    payee: Record<string, any>;
  }): Promise<import('../../application/ports/FiatRampProvider').RampOrder> {
    if (!params.quoteId || typeof params.quoteId !== 'string') {
      throw new Error('quoteId es requerido');
    }
    if (!params.payee || typeof params.payee !== 'object') {
      throw new Error('payee es requerido');
    }

    return this.fiatRampProvider.createRampOrder(params);
  }
}
