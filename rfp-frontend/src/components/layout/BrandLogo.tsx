/**
 * Matters AI brand logo with automatic light/dark variant swap.
 *
 * Drop your two logo files into the frontend's /public folder as:
 *   public/matters-logo-light.svg   (shown on LIGHT backgrounds)
 *   public/matters-logo-dark.svg    (shown on DARK backgrounds)
 * PNGs also work — change the extension below if so.
 *
 * The swap is pure CSS (`dark:` classes), so there's no hydration flash
 * and no JS theme detection needed.
 */
export function BrandLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/matters-logo-dark.png"
        alt="Matters AI"
        className={`${className} block dark:hidden object-contain`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/matters-logo-light.png"
        alt=""
        aria-hidden="true"
        className={`${className} hidden dark:block object-contain`}
      />
    </>
  )
}
