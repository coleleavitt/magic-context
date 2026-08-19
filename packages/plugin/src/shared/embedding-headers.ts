export class InvalidEmbeddingHeadersError extends Error {
    readonly name = "InvalidEmbeddingHeadersError";

    constructor() {
        super("Invalid embedding.headers: header names and values must be valid HTTP headers");
    }
}

export function normalizeEmbeddingHeaders(
    headers: Readonly<Record<string, string>>,
): [string, string][] {
    try {
        return [...new Headers(headers).entries()].sort(([left], [right]) =>
            left.localeCompare(right),
        );
    } catch {
        throw new InvalidEmbeddingHeadersError();
    }
}
