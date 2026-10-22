# Demo script — "Quadratic Equations" (about 6 minutes)

Three people: the **Teacher** (speaks the lines below), the **Student** (deaf; at the laptop with the eye tracker),
and the **Narrator** (talks to the judges; can be the student). The lines are tuned so captions show what Sightline
does best: technical words spelled right and spoken maths turned into real formulas. Rehearse them as written.

Deck to upload: [`quadratic-equations.pdf`](quadratic-equations.pdf) (6 slides). The lecture lives in
`apps/server/scripts/demo-lecture.ts`. Change it there and regenerate the deck (see the end of this page).

## T − 10 min: setup

1. `bun run live` (server + web + look → hear engine + gaze + sign; it checks keys, ports and models first).
   Wait for `✔ ready` and `✔ look → hear model loaded`.
2. Chrome → `http://localhost:3001` (or the deployed site), sign in.
3. **Mic:** a clip-on/USB mic on the teacher is best; the laptop mic works if the teacher stays within 1–2 m.
   Quiet room, no music.
4. Earphones plugged in (look → hear part). Webcam pointed at the student (sign part).
5. **Gaze:** until Arunya's tracker is wired, the operator presses keys in the `bun run live` terminal:
   **b** = student looks at the board, **s** = back to the screen, **p** = at a person.
6. Optional dry run with an AI voice: `bun run --filter server demo:rehearse` (about 4 min; prints every caption).

## Scene 0: before class (Student, ~45 s)

| Student does | Judges see | Narrator says |
| --- | --- | --- |
| New lecture → title **Quadratic Equations**, mode **Deaf** | Lecture prep screen | "Before class, the student gives Sightline the lecture material." |
| Upload `quadratic-equations.pdf` | Slides appear in ~20 s | |
| Wait for the glossary | **Sridharacharya's formula, Discriminant (Delta), Vieta's formulas, Parabola, Vertex, Completing the square…** | "It reads the slides and learns this lecture's jargon, so captions spell it right from the first sentence." |
| **Start lecture**, allow the mic | Live workspace, slide 1 | |

Teacher: wait **2 seconds** after the mic turns on before the first line.

## The lecture (Teacher)

Speak at a normal pace with a short pause (about 1 s) after every sentence: each pause becomes one caption line.
Say maths the way you'd say it in class ("x squared", "all over two a"). The lines in **bold cues** are actions
for the Student, not things to say.

### Scene 1: Opening

> Good morning everyone. Today we are going to study quadratic equations and Sridharacharya's formula.
>
> Most of you know it as the quadratic formula.

Judges see: grey words appear as the teacher speaks, then turn into the clean line. *"Sridharacharya's"* is spelled
correctly. **Narrator:** "That word is where normal captions turn into word salad."

### Scene 2: Standard form

> A quadratic equation has the standard form a x squared plus b x plus c equals zero, where a is not equal to zero.
>
> Here a, b and c are called the coefficients, and the solutions are called the roots.

Judges see: **ax² + bx + c = 0, where a ≠ 0** rendered as maths; the slide preview flips to *Standard Form* by itself.

### Scene 3: The formula

> The roots are given by x equals minus b plus or minus the square root of b squared minus four a c, all over two a.
>
> This formula comes from completing the square.

Judges see: the full quadratic formula as a proper fraction with ± and a square root, from 20 spoken words.
**Narrator:** "A deaf student can't follow 'minus b plus or minus root b squared…'. They can follow this."

### Scene 4: The discriminant and the board (gaze-pause)

> Now this expression, b squared minus four a c, is called the discriminant, and we write it as capital delta.
>
> Let me draw the three cases on the board.

**Cue → Student looks up at the board** (operator: **b**). Teacher points at / draws on the board.

> If delta is greater than zero, we get two real and distinct roots.
>
> If delta equals zero, the two roots are real and equal.
>
> And if delta is less than zero, the roots are complex conjugates.

**Cue → Student looks back at the laptop** (operator: **s**).

Judges see: when the student looked away, the captions **froze at a bookmark** instead of scrolling past; the
3 lines spoken meanwhile are **highlighted as missed** ("you missed 3 lines"), then it catches up. "Let me draw…"
also grabbed a **board snapshot** for the notes. Δ, Δ = 0, Δ < 0 render as maths.
**Narrator:** "A deaf student has to choose between watching the board and reading captions. With the eye tracker,
Sightline knows when they look up and pauses for them. No buttons."

### Scene 5: Worked example

> Let's solve an example. x squared minus five x plus six equals zero.
>
> Here a is one, b is minus five and c is six.
>
> The discriminant is twenty five minus twenty four, which is one.
>
> So x equals five plus or minus one, over two. That gives x equals three or x equals two.

Judges see: x² − 5x + 6 = 0, a = 1, b = −5, c = 6, x = (5 ± 1)/2, x = 3, x = 2; the slide moves to *Worked Example*.

### Scene 6: Vieta and the parabola

> Notice that the sum of the roots is minus b over a, which is five, and the product of the roots is c over a, which is six.
>
> These are called Vieta's formulas.
>
> Finally, the graph of y equals a x squared plus b x plus c is a parabola, and its vertex is at x equals minus b over two a.

**Cue → Student signs "PLEASE REPEAT FORMULA"** in the sign panel (with the mock sign service it fires on its own).

Judges see: the signs become a sentence like **"Could you please repeat the formula?"**, **spoken aloud** by the laptop.
**Narrator:** "And it works both ways: the student can sign, and Sightline speaks for them."

### Scene 7: Answering the student

> Sure. Once more: x equals minus b plus or minus the square root of b squared minus four a c, over two a.

Judges see: the formula again, and the slide preview jumps back to *Sridharacharya's Formula*.

### Scene 8: Wrap-up

> That's all for today. For homework, solve two x squared plus three x minus two equals zero.

**Cue → Student clicks End lecture.**

## Scene 9: look → hear (Hard-of-Hearing mode, ~45 s, optional)

Switch the mode to **Hard of hearing**. The Teacher and a classmate talk at the same time (anything). The Student
looks at the classmate (operator: **p**, or click the classmate's face in the voice-focus panel).
Judges see: face boxes on the scene camera, "listening to …"; in the earphones the classmate's voice stands out.
**Narrator:** "In a noisy room, the voice you look at is the voice you hear. It runs on the laptop, no cloud."

## Scene 10: after class (Student, ~45 s)

| Student does | Judges see | Narrator says |
| --- | --- | --- |
| Wait ~15 s on the wrap-up screen | **Notes ready** | "By the time class ends, the notes are written." |
| Open the notes | Sections, every formula rendered, definitions, **the board snapshot in place**, a marker where the student looked at the board | "Built from what was actually said, not invented. And the board snapshot sits where the teacher drew it." |
| Export .md | A portable file with the images embedded | |
| Recordings | The lecture video with the transcript beside it, seekable | |

## If something goes wrong

| Problem | Do this |
| --- | --- |
| Captions stop, toast "STT error" | Stop and start the mic in the workspace; check the network |
| A formula comes out as words | Fine: the raw caption is always shown; carry on (refinement is best-effort) |
| Notes take long | They're generated in the background; open the notes page again after a few seconds |
| Network is dead | `bun run live -- --mock`: the server replays a recorded lecture, no keys or internet for captions |
| Gaze tracker not ready | Keep the default keyboard gaze (b / s / p) |

## Changing the lecture

Edit `apps/server/scripts/demo-lecture.ts` (slides, context, lines), then:

```bash
cd apps/server
bun -e 'import { textDeckPdf } from "./scripts/fixtures"; import { DEMO } from "./scripts/demo-lecture"; await Bun.write("../../docs/demo/quadratic-equations.pdf", textDeckPdf(DEMO.slides));'
bun run demo:rehearse        # against a running server: prints every caption the student would see
```

Update the quoted lines above too: `bun test` checks that every line in `demo-lecture.ts` appears here word for word.
