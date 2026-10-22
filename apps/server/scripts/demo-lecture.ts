/**
 * The demo lecture: one source for the slide deck (docs/demo/quadratic-equations.pdf), the context, the teacher's
 * lines (docs/demo/demo-script.md) and the rehearsal check (scripts/demo-rehearse.ts).
 * Slide text is plain ASCII on purpose: the generated PDF uses a built-in font.
 */
export type DemoLine = { scene: string; say: string; cue?: string };

export const DEMO = {
  title: "Quadratic Equations",
  subject: "Mathematics",
  context: [
    "Quadratic equations: standard form a x^2 + b x + c = 0 with a not equal to 0; a, b, c are the coefficients; solutions are the roots.",
    "Sridharacharya's formula (the quadratic formula): x = (-b +/- sqrt(b^2 - 4ac)) / 2a, derived by completing the square.",
    "The discriminant Delta = b^2 - 4ac decides the nature of the roots: real and distinct, real and equal, or complex conjugates.",
    "Vieta's formulas: sum of roots = -b/a, product of roots = c/a. The graph y = a x^2 + b x + c is a parabola with its vertex at x = -b/2a.",
  ].join("\n\n"),
  slides: [
    { title: "Quadratic Equations", bullets: ["What makes an equation quadratic", "One formula for every root", "How many roots, and what kind", "What the graph looks like"] },
    { title: "Standard Form", bullets: ["ax^2 + bx + c = 0, with a not equal to 0", "a, b and c are the coefficients", "The solutions are called roots"] },
    { title: "Sridharacharya's Formula", bullets: ["x = (-b +/- sqrt(b^2 - 4ac)) / 2a", "Also called the quadratic formula", "Derived by completing the square"] },
    { title: "The Discriminant", bullets: ["Delta = b^2 - 4ac", "Delta > 0: two real and distinct roots", "Delta = 0: real and equal roots", "Delta < 0: complex conjugate roots"] },
    { title: "Worked Example", bullets: ["x^2 - 5x + 6 = 0", "a = 1, b = -5, c = 6", "Delta = 25 - 24 = 1", "x = 3 or x = 2"] },
    { title: "Vieta's Formulas and the Parabola", bullets: ["Sum of roots = -b/a", "Product of roots = c/a", "y = ax^2 + bx + c is a parabola", "Vertex at x = -b/2a"] },
  ],
  lines: [
    { scene: "1 · Opening", say: "Good morning everyone. Today we are going to study quadratic equations and Sridharacharya's formula." },
    { scene: "1 · Opening", say: "Most of you know it as the quadratic formula." },
    { scene: "2 · Standard form", say: "A quadratic equation has the standard form a x squared plus b x plus c equals zero, where a is not equal to zero." },
    { scene: "2 · Standard form", say: "Here a, b and c are called the coefficients, and the solutions are called the roots." },
    { scene: "3 · The formula", say: "The roots are given by x equals minus b plus or minus the square root of b squared minus four a c, all over two a." },
    { scene: "3 · The formula", say: "This formula comes from completing the square." },
    { scene: "4 · Discriminant + board", say: "Now this expression, b squared minus four a c, is called the discriminant, and we write it as capital delta." },
    { scene: "4 · Discriminant + board", say: "Let me draw the three cases on the board.", cue: "STUDENT LOOKS UP at the board now (gaze keys: press b)" },
    { scene: "4 · Discriminant + board", say: "If delta is greater than zero, we get two real and distinct roots." },
    { scene: "4 · Discriminant + board", say: "If delta equals zero, the two roots are real and equal." },
    { scene: "4 · Discriminant + board", say: "And if delta is less than zero, the roots are complex conjugates.", cue: "STUDENT LOOKS BACK at the laptop (press s): missed lines are highlighted" },
    { scene: "5 · Worked example", say: "Let's solve an example. x squared minus five x plus six equals zero." },
    { scene: "5 · Worked example", say: "Here a is one, b is minus five and c is six." },
    { scene: "5 · Worked example", say: "The discriminant is twenty five minus twenty four, which is one." },
    { scene: "5 · Worked example", say: "So x equals five plus or minus one, over two. That gives x equals three or x equals two." },
    { scene: "6 · Vieta and the parabola", say: "Notice that the sum of the roots is minus b over a, which is five, and the product of the roots is c over a, which is six." },
    { scene: "6 · Vieta and the parabola", say: "These are called Vieta's formulas." },
    { scene: "6 · Vieta and the parabola", say: "Finally, the graph of y equals a x squared plus b x plus c is a parabola, and its vertex is at x equals minus b over two a.", cue: "STUDENT SIGNS: PLEASE REPEAT FORMULA (sign panel) → the laptop speaks the question" },
    { scene: "7 · Answering the student", say: "Sure. Once more: x equals minus b plus or minus the square root of b squared minus four a c, over two a." },
    { scene: "8 · Wrap-up", say: "That's all for today. For homework, solve two x squared plus three x minus two equals zero.", cue: "STUDENT ENDS the lecture → notes generate" },
  ] satisfies DemoLine[],
  /** The student's signed question (sign panel / mock sign service). */
  signedQuestion: ["PLEASE", "REPEAT", "FORMULA"],
};
