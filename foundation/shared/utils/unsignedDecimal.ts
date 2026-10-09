const uint64Maximum = '18446744073709551615'

export function isPositiveUint64Decimal(value: string) {
  return /^[1-9][0-9]*$/.test(value)
    && (value.length < uint64Maximum.length
      || (value.length === uint64Maximum.length && value <= uint64Maximum))
}
