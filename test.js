import escapeStringRegexp from "escape-string-regexp";

const keys = ["world", "hi"];

let result = "hello {world}";
for (const key of keys) {
  const regex = new RegExp(
    "{(?<key>" + escapeStringRegexp(key) + ")(?:\\:(?<format>[^}]+))?}",
    "g",
  );
  console.log(regex);
  result = result.replaceAll(regex, (...args) => {
    console.log(args[args.length - 1]);
    return args[args.length - 1]["format"];
  });
}

console.log(result);
