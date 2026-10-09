// One runtime implementation is shared by Nuxt and the standalone Gateway Worker.
export { canonicalGatewayScope, GATEWAY_ASSERTION_TYPE, GATEWAY_EXCHANGE_PATH,
  gatewayExchangeAllowsLegacy, gatewayExchangeWithLegacy } from '../contracts/gatewayAssertion.mjs'
