/** An original, printed-paper study of a creator clip becoming a SOL fee flow. */
export function CreatorReel({ className }: { className?: string }) {
  const contour = {
    stroke: "#172027",
    strokeWidth: 3.5,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 520 560"
      role="img"
      aria-label="Illustration of a creator holding a vertical video phone, with a conceptual Create, Trades, SOL fee flow."
      focusable="false"
      className={className}
      style={{ display: "block", width: "100%", maxWidth: 520, height: "auto" }}
    >
      {/* The registration marks belong to the composition, not to a UI panel. */}
      <g fill="none" stroke="var(--ink)" strokeWidth={1.5}>
        <path d="M34 76V44H66M454 44H486V76M34 484V516H66M454 516H486V484" />
        <path d="M29 280H44M476 280H491" />
      </g>
      <text x={45} y={29} fill="var(--ink)" fontFamily="monospace" fontSize={10} letterSpacing={2.5}>
        THE CREATOR CUT
      </text>
      <path d="M454 22H486M470 14V30" fill="none" stroke="var(--ink)" strokeWidth={1.5} />

      {/* Two deliberately cropped, vertical takes behind the phone. */}
      <g transform="rotate(-11 177 277)">
        <rect x={79} y={98} width={180} height={320} fill="var(--coral)" />
        <rect x={66} y={85} width={180} height={320} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2} />
        <path d="M66 150L246 330V405H172L66 299Z" fill="var(--lime)" />
        <path d="M66 260L211 405H183L66 288Z" fill="#172027" />
        <path d="M66 303L168 405H155L66 316Z" fill="#172027" />
        <g fill="var(--ink)" opacity={0.32}>
          {Array.from({ length: 60 }, (_, index) => (
            <circle key={index} cx={86 + (index % 6) * 11} cy={112 + Math.floor(index / 6) * 11} r={1.5} />
          ))}
        </g>
        <path d="M83 107H102M83 107V126M228 386H209M228 386V367" fill="none" stroke="var(--ink)" strokeWidth={2.5} />
      </g>

      <g transform="rotate(10 349 275)">
        <rect x={265} y={75} width={162} height={288} fill="var(--card)" stroke="var(--ink)" strokeWidth={2} />
        <path d="M265 96H427M265 341H427" fill="none" stroke="var(--ink)" strokeWidth={1.5} />
        <g fill="var(--coral)">
          <path d="M265 124H288V136H265ZM404 147H427V159H404ZM265 290H288V302H265ZM404 312H427V324H404Z" />
        </g>
      </g>

      {/* Fingers wrap around the far side before the phone is laid over them. */}
      <path
        d="M319 483L286 428L345 338L373 254Q379 235 393 240Q407 245 401 264L395 281Q414 280 414 296Q414 309 402 314Q420 320 415 336Q411 345 401 347Q415 357 406 372Q401 380 388 379L374 410L379 470Z"
        fill="var(--coral)"
        {...contour}
      />

      {/* A 9:16 screen: graphic video imagery, with no invented account data. */}
      <g transform="rotate(8 305 276)">
        <rect x={209} y={100} width={192} height={352} rx={23} fill="#172027" />
        <rect x={204} y={94} width={192} height={352} rx={23} fill="#f0eadc" {...contour} />
        <rect x={219} y={123} width={162} height={288} rx={4} fill="#44ddcf" {...contour} />
        <path d="M279 110H321" stroke="#172027" strokeWidth={5} strokeLinecap="round" />
        <path d="M279 430H321" stroke="#172027" strokeWidth={4} strokeLinecap="round" />

        {/* A rhythmic, cut-paper figure fills the clip rather than a sample profile. */}
        <path d="M220 354L381 193V263L232 411H220Z" fill="#f0eadc" />
        <path d="M237 411L381 267V293L263 411Z" fill="#172027" />
        <path d="M293 411L381 323V336L306 411Z" fill="#172027" />
        <path d="M231 136H250M231 136V155M369 398H350M369 398V379" fill="none" stroke="#172027" strokeWidth={2} />
        <g fill="#172027">
          {Array.from({ length: 42 }, (_, index) => (
            <circle key={index} cx={320 + (index % 7) * 7} cy={141 + Math.floor(index / 7) * 7} r={1.1} />
          ))}
        </g>
        <path d="M244 280L249 231L279 204L296 220L274 246L270 288L293 315L281 327L252 302Z" fill="#ff7467" {...contour} />
        <path d="M291 221L319 235L346 212" fill="none" stroke="#172027" strokeWidth={10} strokeLinecap="square" />
        <path d="M261 292L238 329L254 350M272 295L310 328L306 352" fill="none" stroke="#172027" strokeWidth={13} strokeLinecap="square" />
        <path d="M278 201L265 188L266 169L284 159L301 169L299 188Z" fill="#ff7467" {...contour} />
        <path d="M269 169L287 158L301 171" fill="none" stroke="#172027" strokeWidth={6} />
        <path d="M286 177L293 180M284 188L291 188" stroke="#172027" strokeWidth={2.5} strokeLinecap="round" />

        {/* A bespoke split/play seal, not a borrowed social-platform mark. */}
        <circle cx={348} cy={362} r={23} fill="#ff7467" {...contour} />
        <path d="M337 351L347 358L337 365ZM351 358L361 365L351 372Z" fill="#172027" />
        <path d="M347 350L351 373" stroke="#f0eadc" strokeWidth={2} />
      </g>

      {/* The thumb overlaps the screen; the wrist exits the print at an angle. */}
      <path
        d="M179 507L163 470L185 399L202 348L217 310Q223 295 236 300Q250 305 244 322L233 351L254 378L274 393L300 382L324 427L348 480L293 525Z"
        fill="var(--coral)"
        {...contour}
      />
      <path d="M200 411L214 380L234 366M241 409L254 420L271 418M285 461L300 454" fill="none" {...contour} />
      <path d="M180 495L285 517L299 482L190 457Z" fill="#172027" {...contour} />
      <path d="M204 477L213 479M225 482L234 484M246 487L255 489M267 492L276 494" stroke="#f0eadc" strokeWidth={3} />

      {/* Cut marks and direction lines give the still drawing its rhythm. */}
      <g fill="none" stroke="var(--ink)" strokeLinecap="square">
        <path d="M125 66L111 49M144 57L139 36M162 56L166 40" strokeWidth={3} />
        <path d="M421 177L443 157M428 197L457 186M431 219L463 220" strokeWidth={4} />
        <path d="M88 457L65 471M99 475L82 496" strokeWidth={3} />
      </g>

      {/* Three conceptual stages, with a visible connection and no fake metrics. */}
      <g transform="rotate(-5 117 98)">
        <path d="M42 74H184V118H42Z" fill="#44ddcf" stroke="#172027" strokeWidth={2} />
        <path d="M56 88L69 96L56 104Z" fill="#172027" />
        <text x={82} y={102} fill="#172027" fontFamily="Arial, sans-serif" fontSize={18} fontWeight={800} letterSpacing={1}>CREATE</text>
      </g>
      <path d="M111 136L89 178L114 213" fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 6" />
      <path d="M104 213L114 216L115 205" fill="none" stroke="var(--ink)" strokeWidth={2} />

      <g transform="rotate(-8 112 267)">
        <path d="M37 242H176V285H37Z" fill="#172027" stroke="#f0eadc" strokeWidth={1} />
        <path d="M49 263H66M60 257L66 263L60 269M49 275H66M55 269L49 275L55 281" fill="none" stroke="#44ddcf" strokeWidth={2} />
        <text x={77} y={271} fill="#f0eadc" fontFamily="Arial, sans-serif" fontSize={18} fontWeight={800} letterSpacing={1}>TRADES</text>
      </g>
      <path d="M91 307L66 345L90 378L143 380" fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 6" />
      <path d="M136 374L144 380L136 386" fill="none" stroke="var(--ink)" strokeWidth={2} />

      <g transform="rotate(7 415 452)">
        <path d="M358 428H470V474H358Z" fill="#44ddcf" {...contour} />
        <path d="M372 441H391L387 445H368ZM368 449H387L391 453H372ZM372 457H391L387 461H368Z" fill="#172027" />
        <text x={402} y={458} fill="#172027" fontFamily="Arial, sans-serif" fontSize={20} fontWeight={800} letterSpacing={1}>SOL</text>
      </g>
      <path d="M385 402L422 398L431 415" fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 6" />
      <path d="M423 412L432 417L435 407" fill="none" stroke="var(--ink)" strokeWidth={2} />
      <text x={42} y={548} fill="var(--ink)" fontFamily="monospace" fontSize={9} letterSpacing={1.5}>A CLIP. A COMMUNITY. A CREATOR.</text>
      <path d="M448 540H485M461 535V546M472 535V546" fill="none" stroke="var(--ink)" strokeWidth={1.5} />
    </svg>
  );
}
