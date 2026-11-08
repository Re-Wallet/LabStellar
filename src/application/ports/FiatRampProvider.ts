/**
 * Puerto de salida: proveedor de ramps (on/off-ramp) para fusar fiat ↔ cripto.
 *
 * Define la interfaz para crear cotizaciones y órdenes de rampa a través de
 * un proveedor externo (ej. Pollar). El dominio no conoce la implementación
 * externa; solo depende de esta interfaz.
 *
 * Estructura alineada con Pollar Server API v3:
 * https://docs.pollar.xyz/docs/sdk-reference/pollar-core
 *
 * Nota: en la respuesta de Pollar v3, amountIn/amountOut son strings (no objetos),
 * y los importes por pierna están dentro de cada RampLeg.
 */
export interface FiatRampProvider {
  /**
   * Solicita una cotización para convertir entre monedas.
   *
   * @param params - direction: 'on' (fiat→cripto) o 'off' (cripto→fiat).
   *                 fiat: { currency, rail, country } del activo fiat (ej. ARS vía HOSTED).
   *                 asset: { code, identifier, chain } del cripto (ej. COP en STELLAR).
   *                 amount: monto, con 'value' (string) y 'denomination' ('in' = lo que el usuario paga, 'out' = lo que recibe).
   * @returns Cotización con detalles de las rutas, importes, comisiones y campos requeridos del usuario.
   */
  quoteRamp(params: {
    direction: 'on' | 'off';
    fiat: { currency: string; rail?: string; country?: string };
    asset: { code: string; identifier?: string | null; chain: 'STELLAR' | 'POLYGON' | 'SOLANA' };
    amount: { value: string; denomination: 'in' | 'out' };
  }): Promise<RampQuote>;

  /**
   * Crea una orden de rampa a partir de una cotización aceptada.
   *
   * @param quoteId - ID de la cotización devuelta por quoteRamp.
   * @param payee   - Datos del destinatario/pagador según los campos requeridos por la ruta (requiredFields de la cotización).
   * @returns Orden creada con su estado inicial y acciones pendientes (pendingAction).
   */
  createRampOrder(params: {
    quoteId: string;
    payee: Record<string, any>;
  }): Promise<RampOrder>;

  /**
   * Consulta el estado de una orden de rampa existente.
   *
   * @param orderId - ID de la orden devuelta por createRampOrder.
   * @returns Estado actual de la orden (incluye pendingAction si espera acción del usuario).
   */
  getOrderStatus(orderId: string): Promise<RampOrder>;

  /**
   * Lista los pares fiat↔cripto disponibles para rampa en una dirección.
   *
   * @param direction - 'on' (on-ramp) o 'off' (off-ramp).
   * @returns Rutas disponibles con sus pares fiat/asset y tipos de pierna.
   */
  getRampRoutes(direction: 'on' | 'off'): Promise<{ routes: RampRoute[] }>;

  /**
   * Vincula una wallet externa (no-custodial) al usuario en Pollar.
   *
   * @param chain - Cadena de la wallet ('STELLAR', 'POLYGON' o 'SOLANA').
   * @param address - Dirección pública de la wallet del usuario.
   */
  linkWallet(chain: 'STELLAR' | 'POLYGON' | 'SOLANA', address: string): Promise<void>;

  /**
   * Firma una pierna de rampa pendiente (SIGNATURE) con la wallet del usuario.
   *
   * @param orderId - ID de la orden.
   * @param legIndex - Índice de la pierna a firmar.
   * @returns La orden actualizada después de la firma.
   */
  signRampLeg(orderId: string, legIndex: number): Promise<RampOrder>;

  /**
   * Inicia una sesión KYC para el usuario actual (Full Verification: ID + selfie + address + sanctions + device).
   *
   * @param params - providerId y corridorId para iniciar la verificación.
   * @returns Resultado con la URL de KYC a la que el usuario debe ir.
   */
  startKyc(params: StartKycParams): Promise<RampKycStatus>;

  /**
   * Consulta el estado de una sesión KYC.
   *
   * @param corridorId - ID del corredor (corridor) de la sesión KYC.
   * @returns Estado actual del KYC (none, pending, approved, rejected, expired).
   */
  getKycStatus(corridorId: string): Promise<RampKycStatus>;
}

/**
 * Respuesta de cotización de rampa (Pollar Server API v3).
 *
 * En la respuesta real de Pollar v3, quoteId/amountIn/amountOut/expiresAt/etaSeconds
 * están dentro de cada elemento del array `quotes`, no en el nivel superior.
 */
export interface RampQuote {
  /** Rutas disponibles, cada una con su propio quoteId e importes */
  quotes: RampRoute[];
  /** Rutas que no pudieron cotizar, con motivo */
  rejected?: RampRejection[];
}

/**
 * Una ruta de rampa (una secuencia de piernas).
 * Se usa tanto para el listado de rutas (getRampRoutes) como dentro de una cotización.
 * Dentro de una cotización, cada ruta tiene su propio quoteId, amountIn, amountOut, etc.
 */
export interface RampRoute {
  /** ID de la cotización (solo presente dentro de una respuesta de quoteRamp) */
  quoteId?: string;
  /** Monto que el usuario entrega (fiat), como string decimal (solo en quote) */
  amountIn?: string;
  /** Monto que el usuario recibe (cripto), como string decimal (solo en quote) */
  amountOut?: string;
  /** Tiempo estimado en segundos (solo en quote) */
  etaSeconds?: number;
  /** Fecha de expiración de la cotización (solo en quote) */
  expiresAt?: string;
  /** Parámetros fiat de la ruta */
  fiat: { currency: string; rail: string; country: string };
  /** Parámetros del activo cripto de la ruta */
  asset: { code: string; identifier?: string | null; chain: 'STELLAR' | 'POLYGON' | 'SOLANA' };
  /** Piernas de la ruta */
  legs: RampLeg[];
  /** Campos que el usuario debe rellenar para esta ruta */
  requiredFields?: RampField[];
}

/**
 * Una pierna de la ruta.
 */
export interface RampLeg {
  index: number;
  kind: 'PROVIDER_ONRAMP' | 'PROVIDER_OFFRAMP' | 'SWAP' | 'BRIDGE';
  from?: { kind: 'fiat' | 'asset'; currency: string; rail?: string; country?: string };
  to?: { kind: 'asset'; code: string; identifier?: string | null; chain: 'STELLAR' | 'POLYGON' | 'SOLANA' };
  /** Monto de entrada, como string decimal */
  amountIn?: string;
  /** Monto de salida, como string decimal */
  amountOut?: string;
  /** Comisiones del proveedor */
  providerFees?: RampFee[];
  /** Comisiones totales */
  fees?: RampFee[];
  /** Tiempo estimado en segundos */
  etaSeconds?: number;
  /** Wallet involucrada en esta pierna */
  wallet?: { chain: string; address: string; mode: string; signs: boolean };
  /** Campos que el usuario debe rellenar */
  requiredFields?: RampField[];
}

/**
 * Comisión de una pierna de rampa.
 */
export interface RampFee {
  beneficiary: 'PROVIDER' | 'END_USER';
  payer: 'PROVIDER' | 'END_USER';
  settlement: string;
  basis: string;
  basisAmount: string;
  basisCurrency: string;
  amount: string;
  currency: string;
  usdValue?: string;
}

/**
 * Campo que el usuario debe rellenar en una ruta.
 */
export interface RampField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'phone' | 'select' | 'checkbox';
  required: boolean;
  options?: { label: string; value: string }[]; // solo para select
}

/**
 * Ruta que no pudo cotizar.
 */
export interface RampRejection {
  routeId: string;
  reason: string;
  helpUrl?: string;
}

/**
 * Orden de rampa creada.
 */
export interface RampOrder {
  /** ID de la orden (Pollar v3 usa 'id', no 'orderId') */
  id: string;
  direction: 'ONRAMP' | 'OFFRAMP';
  state: 'created' | 'awaiting_payment' | 'processing' | 'settling_onchain' | 'completed' | 'failed' | 'refunded';
  quoteId: string;
  /** Piernas de la orden (cada una con estado y hash en cadena si aplica) */
  legs: RampOperation[];
  /** Acción pendiente que el usuario debe realizar (si aplica) */
  pendingAction?: RampPendingAction;
  /** Hash de transacción en cadena, si aplica */
  txHash?: string;
  /** Cuándo leer de nuevo la orden (null si ya no se mueve) */
  nextPollAfter?: string | null;
  createdAt: string;
}

/**
 * Pierna de una orden de rampa.
 */
export interface RampOperation {
  kind: 'PROVIDER_ONRAMP' | 'PROVIDER_OFFRAMP' | 'SWAP' | 'BRIDGE';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  destination?: string;
  asset?: string;
  amount?: string;
  txHash?: string;
  /** ID de la acción para la firma (presente en acciones SIGNATURE) */
  actionId?: string;
}

/**
 * Acción pendiente que el usuario debe realizar.
 */
export interface RampPendingAction {
  kind: 'FIAT_PAYMENT' | 'SIGNATURE' | 'COSIGN_APPROVAL' | 'KYC' | 'NONE';
  /** Instrucciones legibles para el usuario */
  instructions?: string;
  /** Datos para construir la acción (XDR, URL, etc.) */
  payload?: Record<string, any>;
  /** ID de la acción para la firma (presente en acciones SIGNATURE) */
  actionId?: string;
  /** Tiempo de expiración de la acción (ISO 8601) */
  expiresAt?: string;
}

/**
 * Resultado de una acción de firma (para COSIGN_APPROVAL o SIGNATURE).
 */
export interface SignActionResult {
  success: boolean;
  signedPayload?: string; // XDR u otro payload firmado
  error?: string;
}

/**
 * Estado de una verificación KYC.
 */
export interface RampKycStatus {
  /** Estado del KYC: 'none', 'pending', 'approved', 'rejected', 'expired' */
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'expired';
  /** ID del corredor (corridor) asociado al KYC */
  corridorId?: string;
  /** ID del proveedor KYC */
  providerId?: string;
  /** URL a la que el usuario debe ir para completar la verificación */
  kycUrl?: string;
  /** Tiempo de expiración de la sesión KYC (ISO 8601) */
  expiresAt?: string;
  /** Razón del rechazo (si status es 'rejected') */
  reason?: string;
  /** Campos faltantes o inválidos (si aplica) */
  missingFields?: string[];
}

/**
 * Parámetros para iniciar una sesión KYC.
 */
export interface StartKycParams {
  /** ID del proveedor KYC (obtenido de getKycProviders o de rejected del quote) */
  providerId: string;
  /** ID del corredor (corridor) de la ruta de rampa */
  corridorId: string;
  /** Clave de idempotencia para reintentos seguros */
  idempotencyKey?: string;
}
