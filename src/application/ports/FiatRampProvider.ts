/**
 * Puerto de salida: proveedor de ramps (on/off-ramp) para fusar fiat ↔ cripto.
 *
 * Define la interfaz para crear cotizaciones y órdenes de rampa a través de
 * un proveedor externo (ej. Pollar). El dominio no conoce la implementación
 * externa; solo depende de esta interfaz.
 */
export interface FiatRampProvider {
  /**
   * Solicita una cotización para convertir entre monedas.
   *
   * @param params - direction: 'on' (fiat→cripto) o 'off' (cripto→fiat).
   *                 fiat: código del activo fiat (ej. 'ARS').
   *                 asset: código del cripto (ej. 'USDC').
   *                 amount: monto, con 'value' (número) y 'denomination' ('in' = lo que el usuario paga, 'out' = lo que recibe).
   * @returns Cotización con detalles de las rutas, importes, comisiones y campos requeridos del usuario.
   */
  quoteRamp(params: {
    direction: 'on' | 'off';
    fiat: string;
    asset: string;
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
}

/**
 * Respuesta de cotización de rampa.
 */
export interface RampQuote {
  quoteId: string;
  success: boolean;
  /** Rutas disponibles, ordenadas de mejor a peor */
  quotes: RampRoute[];
  /** Rutas que no pudieron cotizar, con motivo */
  rejected?: RampRejection[];
}

/**
 * Una ruta de rampa (una secuencia de piernas).
 */
export interface RampRoute {
  routeId: string;
  /** Piernas de la ruta */
  legs: RampLeg[];
  /** Cantidad que el usuario entrega (fiat) */
  amountIn: { value: string; currency: string };
  /** Cantidad que el usuario recibe (cripto) */
  amountOut: { value: string; asset: string };
  /** Comisión total en USD */
  fee?: { value: string; currency: string };
  /** Tiempo estimado en segundos */
  etaSeconds?: number;
  /** Campos que el usuario debe rellenar para esta ruta */
  requiredFields?: RampField[];
}

/**
 * Una pierna de la ruta.
 */
export interface RampLeg {
  kind: 'PROVIDER_ONRAMP' | 'PROVIDER_OFFRAMP' | 'SWAP' | 'BRIDGE';
  from?: { currency: string; chain?: string };
  to?: { asset: string; chain?: string };
  amountIn?: { value: string; currency: string };
  amountOut?: { value: string; currency: string };
  fees?: { value: string; currency: string }[];
  wallet?: string; // dirección de wallet involucrada (si aplica)
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
  orderId: string;
  status: 'created' | 'awaiting_payment' | 'processing' | 'settling_onchain' | 'completed' | 'failed' | 'refunded';
  quoteId: string;
  operations: RampOperation[];
  /** Acción pendiente que el usuario debe realizar (si aplica) */
  pendingAction?: RampPendingAction;
  /** Hash de transacción en cadena, si aplica */
  txHash?: string;
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
