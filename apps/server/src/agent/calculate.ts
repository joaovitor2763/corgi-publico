// Exact arithmetic for the agent: totals, percentages and differences it shows the person are
// computed here instead of in the model's head (which got "880/980 → -11%" wrong). A tiny
// recursive-descent parser over numbers and + - * / ( ) — no eval, no names, no functions.

export function calculate(expression: string): number {
  const text = expression.replace(/\s+/g, "").replace(/,/g, ".");
  if (!/^[\d.+\-*/()]+$/.test(text) || text.length > 300)
    throw new Error("Use only numbers and + - * / ( ).");
  let at = 0;
  const peek = () => text[at];
  const number = () => {
    const match = text.slice(at).match(/^\d+(\.\d+)?|^\.\d+/);
    if (!match) throw new Error(`Expected a number at position ${at + 1}.`);
    at += match[0].length;
    return Number(match[0]);
  };
  const factor = (): number => {
    if (peek() === "-") {
      at++;
      return -factor();
    }
    if (peek() === "+") {
      at++;
      return factor();
    }
    if (peek() === "(") {
      at++;
      const value = sum();
      if (peek() !== ")") throw new Error("Missing ).");
      at++;
      return value;
    }
    return number();
  };
  const product = (): number => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const op = text[at++];
      const right = factor();
      if (op === "/" && right === 0) throw new Error("Division by zero.");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const op = text[at++];
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  if (at !== text.length) throw new Error(`Unexpected "${text[at]}" at position ${at + 1}.`);
  return Math.round(result * 1e10) / 1e10;
}
