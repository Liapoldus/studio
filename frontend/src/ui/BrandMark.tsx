import symbol from '../assets/brand/logo/liapoldus-mark.svg'

type BrandMarkProps = {
  size?: number
  className?: string
}

/** The user-provided Liapoldus mark; the orange artwork is kept unchanged. */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <span className={`brand-mark${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <img src={symbol} alt="" aria-hidden="true" />
    </span>
  )
}
