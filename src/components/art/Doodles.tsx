// Dev doodles that decorate pages: Bitbug, "</>" and "{ }" stickers, a little git graph, sparkles.
// Purely decorative (aria-hidden, no pointer events); each sits inside its own box, so none of them
// can widen the page.
import { Bug } from "./Bug";
import { Braces, C, CodeTag, Commits, MiniCoin, Sparkle } from "./parts";

const box = "pointer-events-none absolute select-none";

/** The hero's side doodles: big ones beside the headline on wide screens, small ones on phones. */
export function HeroDoodles() {
  return (
    <>
      {/* wide screens: Bitbug carrying a coin on the left, code stickers and a git graph on the right */}
      <svg aria-hidden="true" focusable="false" viewBox="0 0 170 190" className={`${box} left-0 top-16 hidden w-[160px] xl:block`}>
        <g className="animate-float" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <g transform="rotate(-14 84 104)">
            <Bug x={84} y={104} size={110} face="wink" />
          </g>
        </g>
        <g className="animate-wiggle" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <MiniCoin cx={138} cy={44} r={15} sw={2.4} split />
        </g>
        <Braces x={30} y={34} s={34} sw={2} rot={-10} />
        <Sparkle x={150} y={160} s={9} color={C.pink} sw={2} />
      </svg>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 170 190" className={`${box} right-0 top-14 hidden w-[160px] xl:block`}>
        <g className="animate-wiggle" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <CodeTag x={86} y={42} s={70} sw={2.4} rot={8} />
        </g>
        <Commits x={62} y={82} s={86} sw={3} />
        <Sparkle x={130} y={120} s={11} color={C.sun} sw={2.2} />
        <Sparkle x={24} y={100} s={6} color={C.sky} sw={1.8} />
      </svg>

      {/* phones and tablets: two small stickers in the top corners */}
      <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={`${box} left-1 top-1 w-10 xl:hidden`}>
        <CodeTag x={20} y={20} s={26} sw={1.4} rot={-10} />
      </svg>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={`${box} right-1 top-3 w-8 xl:hidden`}>
        <Sparkle x={20} y={21} s={12} color={C.sun} sw={2.2} />
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
      {kind === "star" && <CodeTag x={20} y={21} s={28} sw={1.5} rot={-8} />}
      {kind === "coin" && (
        <g transform="rotate(-12 20 20)">
          <Bug x={20} y={20} size={34} shadow={false} sw={3.2} />
        </g>
      )}
    </svg>
  );
}

/** Stickers for a card's corner: sits in the card's top-right, inside it. */
export function CornerConfetti({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 96 64" className={`${box} right-3 top-3 w-[96px] ${className}`}>
      <Braces x={22} y={22} s={26} color={C.sky} sw={1.5} rot={-12} />
      <CodeTag x={68} y={18} s={30} color={C.pink} sw={1.4} rot={10} />
      <Sparkle x={52} y={46} s={7} color={C.sun} sw={1.8} />
      <Sparkle x={86} y={48} s={4.5} color={C.lime} sw={1.4} />
    </svg>
  );
}
