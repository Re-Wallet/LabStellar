import {
  FiatRampProvider,
  RampQuote,
  RampOrder,
  RampRoute,
  RampKycStatus,
  StartKycParams,
} from '../../application/ports/FiatRampProvider';
import { SecretProvider } from '../../application/ports/SecretProvider';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

/**
 * Adaptador de infraestructura: proveedor de ramps vía Pollar API.
 *
 * Se comunica con la Server API de Pollar (server.api.pollar.xyz/v3) para crear
 * cotizaciones y órdenes de on/off-ramp entre moneda fiat y cripto (USDC).
 *
 * Autenticación: header `x-pollar-api-key` con la clave secreta de Pollar
 * (sec_testnet_* / sec_mainnet_*), inyectada vía el puerto SecretProvider.
 *
 * Referencia oficial: https://docs.pollar.xyz/docs/sdk-reference/pollar-core
 *
 * `fetch` es inyectable para pruebas sin red.
 */
export class PollarRampProvider implements FiatRampProvider {
  constructor(
    private readonly polarSecretProvider: SecretProvider,
    private readonly stellarSecretProvider: SecretProvider,
    private readonly externalUserId: string,
    private readonly baseUrl: string = 'https://server.api.pollar.xyz/v3',
    private readonly fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) {}

  private async fetchWithAuth(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const apiKey = await this.polarSecretProvider.getSponsorSecret();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-pollar-api-key': apiKey,
      'x-pollar-external-user-id': this.externalUserId,
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

  /**
   * Extrae el campo `content` de la respuesta envuelta de Pollar Server API v3.
   *
   * Todas las respuestas exitosas vienen en el formato:
   *   { "content": <datos>, "code": "<código>", "success": true }
   */
  private async extractContent<T>(res: Response): Promise<T> {
    const data = await res.json();
    return data.content ?? data;
  }

  async quoteRamp(params: {
    direction: 'on' | 'off';
    fiat: { currency: string; rail?: string; country?: string };
    asset: { code: string; identifier?: string | null; chain: 'STELLAR' | 'POLYGON' | 'SOLANA' };
    amount: { value: string; denomination: 'in' | 'out' };
  }): Promise<RampQuote> {
    const res = await this.fetchWithAuth('/ramps/quotes', {
      method: 'POST',
      body: JSON.stringify({
        direction: params.direction === 'on' ? 'ONRAMP' : 'OFFRAMP',
        fiat: params.fiat,
        asset: params.asset,
        amount: params.amount,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar quoteRamp failed: ${res.status} ${errorBody}`,
      );
    }

    return this.extractContent<RampQuote>(res);
  }

  async createRampOrder(params: {
    quoteId: string;
    payee: Record<string, any>;
  }): Promise<RampOrder> {
    const res = await this.fetchWithAuth('/ramps/orders', {
      method: 'POST',
      body: JSON.stringify({
        quoteId: params.quoteId,
        payee: params.payee,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar createRampOrder failed: ${res.status} ${errorBody}`,
      );
    }

    return this.extractContent<RampOrder>(res);
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

    return this.extractContent<RampOrder>(res);
  }

  async getRampRoutes(direction: 'on' | 'off'): Promise<{ routes: RampRoute[] }> {
    const res = await this.fetchWithAuth(
      `/ramps/routes?direction=${direction === 'on' ? 'ONRAMP' : 'OFFRAMP'}`,
      { method: 'GET' },
    );

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar getRampRoutes failed: ${res.status} ${errorBody}`,
      );
    }

    const data = await res.json();
    const routes = data.content?.routes ?? data.routes ?? [];
    return { routes };
  }

  async linkWallet(
    chain: 'STELLAR' | 'POLYGON' | 'SOLANA',
    address: string,
  ): Promise<void> {
    const res = await this.fetchWithAuth(
      `/ramps/customers/wallets/${chain}`,
      {
        method: 'PUT',
        body: JSON.stringify({ address }),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      // 409 Conflict: same address again is a no-op, treat as success
      if (res.status === 409) {
        return;
      }
      throw new Error(
        `Pollar linkWallet failed: ${res.status} ${errorBody}`,
      );
    }
  }

  /**
   * Firma una pierna de rampa pendiente (SIGNATURE) con la wallet del usuario.
   *
   * Obtiene la orden actual, encuentra la pierna con acción pendiente de tipo
   * SIGNATURE, firma el XDR con la clave secreta del usuario y envía la firma
   * a Pollar Server API v3.
   *
   * Endpoint: POST /v3/ramps/orders/{orderId}/legs/{legIndex}/signature
   * Body: { actionId, signedPayload }
   */
  async signRampLeg(orderId: string, legIndex: number): Promise<RampOrder> {
    // 1. Obtener la orden actual para encontrar el actionId y el XDR a firmar
    const order = await this.getOrderStatus(orderId);

    // 2. Encontrar la pierna con acción pendiente de tipo SIGNATURE
    const pendingAction = order.pendingAction;
    if (!pendingAction || pendingAction.kind !== 'SIGNATURE') {
      throw new Error(
        `Pollar signRampLeg: la orden no tiene una acción pendiente de tipo SIGNATURE`,
      );
    }

    // 3. Obtener el actionId y el XDR del payload
    const actionId = pendingAction.actionId;
    if (!actionId) {
      throw new Error(
        'Pollar signRampLeg: no se encontró actionId en la acción pendiente',
      );
    }

    const payload = pendingAction.payload ?? {};

    // El XDR puede estar en payload.value (estructura real de Pollar v3)
    // o en otros campos según la versión
    const xdr =
      payload.value ??
      payload.xdr ??
      payload.transactionXdr ??
      payload.transaction ??
      '';

    if (!xdr) {
      throw new Error(
        'Pollar signRampLeg: no se encontró XDR para firmar en el payload (probado en payload.value, payload.xdr, payload.transactionXdr, payload.transaction)',
      );
    }

    // 4. Firmar el XDR con la clave secreta del usuario
    const userSecret = await this.stellarSecretProvider.getSponsorSecret();
    const userKeypair = Keypair.fromSecret(userSecret);

    try {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(userKeypair);
      const signedXdr = tx.toXDR();

      // 5. Enviar la firma a Pollar
      const res = await this.fetchWithAuth(
        `/ramps/orders/${orderId}/legs/${legIndex}/signature`,
        {
          method: 'POST',
          body: JSON.stringify({
            actionId,
            signedPayload: signedXdr,
          }),
        },
      );

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(
          `Pollar signRampLeg failed: ${res.status} ${errorBody}`,
        );
      }

      return this.extractContent<RampOrder>(res);
    } catch (err: any) {
      if (err.message?.startsWith('Pollar signRampLeg')) {
        throw err;
      }
      throw new Error(
        `Pollar signRampLeg: error firmando XDR: ${err.message}`,
      );
    }
  }

  /**
   * Inicia una sesión KYC (Full Verification: ID + selfie + address + sanctions + device).
   *
   * Envía la solicitud a Pollar para iniciar la verificación de identidad.
   * El usuario debe visitar la kycUrl devuelta para completar la verificación.
   *
   * Endpoint: POST /v3/ramps/kyc/start
   * Body: { providerId, corridorId }
   */
  async startKyc(params: StartKycParams): Promise<RampKycStatus> {
    const res = await this.fetchWithAuth('/ramps/kyc/start', {
      method: 'POST',
      body: JSON.stringify({
        providerId: params.providerId,
        corridorId: params.corridorId,
        ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar startKyc failed: ${res.status} ${errorBody}`,
      );
    }

    return this.extractContent<RampKycStatus>(res);
  }

  /**
   * Consulta el estado de una sesión KYC.
   *
   * Endpoint: GET /v3/ramps/kyc/status?corridorId=...
   */
  async getKycStatus(corridorId: string): Promise<RampKycStatus> {
    const res = await this.fetchWithAuth(
      `/ramps/kyc/status?corridorId=${encodeURIComponent(corridorId)}`,
      { method: 'GET' },
    );

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Pollar getKycStatus failed: ${res.status} ${errorBody}`,
      );
    }

    return this.extractContent<RampKycStatus>(res);
  }
}
