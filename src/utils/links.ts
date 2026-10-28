export function googlePersonSearchUrl(name: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(name)}`
}
