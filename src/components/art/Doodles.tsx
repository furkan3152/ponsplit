// Little sticker doodles that decorate pages: a happy split coin, a stack of coins, stars,
// sparkles and confetti. Purely decorative (aria-hidden, no pointer events); each sits inside its
// own box, so none of them can widen the page.
import { C, Confetti, INK, MiniCoin, Sparkle, SplitCoin, Star } from "./parts";

const box = "pointer-events-none absolute select-none";

/** The hero's side doodles: big ones beside the headline on wide screens, small sparkles on phones. */
export function HeroDoodles() {
  return (
    <>
      {/* wide screens: a happy split coin on the left, a stack of coins on the right */}
      <svg aria-hidden="true" focusable="false" viewBox="0 0 160 170" className={`${box} left-0 top-20 hidden w-[150px] xl:block`}>
        <g className="animate-float" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <SplitCoin cx={78} cy={92} r={46} sw={3.2} shadow={4} face="joy" />
        </g>
        <Sparkle x={24} y={30} s={10} color={C.sun} sw={2.2} />
        <Confetti x={138} y={40} kind="w" color={C.pink} sw={1.6} rot={-18} />
        <Confetti x={20} y={150} kind="r" color={C.sky} sw={2.2} rot={24} />
        <Confetti x={140} y={150} kind="d" color={C.lilac} sw={2.4} />
      </svg>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 160 170" className={`${box} right-0 top-16 hidden w-[150px] xl:block`}>
        <g className="animate-wiggle" style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
          <ellipse cx={82} cy={150} rx={44} ry={7} fill={INK} opacity={0.12} />
          <MiniCoin cx={82} cy={132} r={30} sw={3} color={C.sun} />
          <MiniCoin cx={74} cy={104} r={30} sw={3} color={C.orange} />
          <MiniCoin cx={86} cy={76} r={30} sw={3} split />
        </g>
        <Star x={132} y={34} s={15} color={C.lime} sw={2.6} rot={12} />
        <Sparkle x={30} y={44} s={8} color={C.pink} sw={2} />
        <Confetti x={24} y={120} kind="d" color={C.green} sw={2.4} />
      </svg>

      {/* phones and tablets: two small sparkles in the top corners */}
      <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={`${box} left-1 top-1 w-9 xl:hidden`}>
        <Sparkle x={18} y={20} s={11} color={C.sun} sw={2.2} />
      </svg>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={`${box} right-1 top-3 w-8 xl:hidden`}>
        <Star x={20} y={21} s={13} color={C.pink} sw={2.4} rot={-10} />
      </svg>
    </>
  );
}

/** A small sticker to sit beside a section heading. */
export function HeadingDoodle({ kind = "sparkle", className = "" }: { kind?: "sparkle" | "star" | "coin"; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={`pointer-events-none inline-block h-8 w-8 shrink-0 select-none ${className}`}>
      {kind === "sparkle" && (
        <>
          <Sparkle x={17} y={22} s={12} color={C.sun} sw={2.2} />
          <Sparkle x={33} y={9} s={5} color={C.pink} sw={1.6} />
        </>
      )}
      {kind === "star" && <Star x={20} y={21} s={14} color={C.lime} sw={2.4} rot={-8} />}
      {kind === "coin" && <MiniCoin cx={19} cy={19} r={14} sw={2.4} split />}
    </svg>
  );
}

/** Confetti for a card's corners: sits in the card's top-right, inside it. */
export function CornerConfetti({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 90 60" className={`${box} right-3 top-3 w-[90px] ${className}`}>
      <Confetti x={20} y={16} kind="w" color={C.sky} sw={1.5} rot={-14} />
      <Confetti x={62} y={12} kind="r" color={C.pink} sw={2} rot={30} />
      <Confetti x={78} y={38} kind="d" color={C.sun} sw={2.2} />
      <Sparkle x={46} y={40} s={7} color={C.lime} sw={1.8} />
    </svg>
  );
}
