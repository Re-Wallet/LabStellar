import {
  FiatRampProvider,
  RampQuote,
  RampOrder,
} from '../../application/ports/FiatRampProvider';
import { SecretProvider } from '../../application/ports/SecretProvider';

/**
 * Adaptador de infraestructura: proveedor de ramps vía Pollar API.
 *
 * Se comunica con la Server API de Pollar (server.api.pollar.xyz/v3) para crear
 * cotizaciones y órdenes de on/off-ramp entre moneda fiat y cripto (USDC).
 *
 * Requiere una clave secreta de Pollar (sec_testnet_* / sec_mainnet_*)
 * inyectada vía el puerto SecretProvider.
 *
 * `fetch` es inyectable para pruebas sin red.
 */
export class PollarRampProvider implements FiatRampProvider {
  constructor(
    private readonly sponsorSecretProvider: SecretProvider,
    private readonly baseUrl: string = 'https://server.api.pollar.xyz/v3',
    private readonly fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) {}

  private async fetchWithAuth(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const sponsorSecret = await this.sponsorSecretProvider.getSponsorSecret();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (init.headers) {
      for (const [key, value] of Object.entries(init.headers)) {
        headers[String(key)] = String(value);
      }
    }

    const fetchFn = this.fetchFn ?? fetch;
    return fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'omit',
    });
  }

  async quoteRamp(params: {
    direction: 'on' | 'off';
    fiat: string;
    asset: string;
    amount: { value: string; denomination: 'in' | 'out' };
  }): Promise<RampQuote> {
    const res = await this.fetchWithAuth('/ramps/quotes', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar quoteRamp failed: ${res.status} ${errorBody}`,
      );
    }

    return res.json();
  }

  async createRampOrder(params: {
    quoteId: string;
    payee: Record<string, any>;
  }): Promise<RampOrder> {
    const res = await this.fetchWithAuth('/ramps/orders', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar createRampOrder failed: ${res.status} ${errorBody}`,
      );
    }

    return res.json();
  }

  async getOrderStatus(orderId: string): Promise<RampOrder> {
    const res = await this.fetchWithAuth(`/ramps/orders/${orderId}`, {
      method: 'GET',
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar getOrderStatus failed: ${res.status} ${errorBody}`,
      );
    }

    return res.json();
  }
}
