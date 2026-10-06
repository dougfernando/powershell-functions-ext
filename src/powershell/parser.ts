export interface PowerShellFunction {
    name: string
    title?: string
    icon: string
    description?: string
    keywords: string[]
    requiresConfirmation: boolean
    timeout: number
    line: number
}

interface Token {
    value: string
    line: number
}

const DEFAULT_ICON = "Icon.Cog"
const DEFAULT_TIMEOUT = 60_000
const FUNCTION_NAME = /^(?:(?:global|script|local|private):)?([A-Za-z0-9_-]+)$/i

function tokenize(content: string): Token[] {
    const tokens: Token[] = []
    let index = 0
    let line = 1
    const advance = () => {
        if (content[index] === "\n") line++
        index++
    }

    while (index < content.length) {
        const character = content[index]
        const next = content[index + 1]
        if (/\s/.test(character)) {
            advance()
            continue
        }
        if (character === "#") {
            while (index < content.length && content[index] !== "\n") advance()
            continue
        }
        if (character === "<" && next === "#") {
            advance()
            advance()
            while (index < content.length && !(content[index] === "#" && content[index + 1] === ">")) advance()
            if (index < content.length) {
                advance()
                advance()
            }
            continue
        }
        if (character === "@" && (next === "'" || next === '"')) {
            const quote = next
            advance()
            advance()
            while (index < content.length) {
                const atLineStart = index === 0 || content[index - 1] === "\n"
                if (atLineStart && content[index] === quote && content[index + 1] === "@") {
                    advance()
                    advance()
                    break
                }
                advance()
            }
            continue
        }
        if (character === "'" || character === '"') {
            const quote = character
            advance()
            while (index < content.length) {
                if (content.charCodeAt(index) === 96 && quote === '"') {
                    advance()
                    if (index < content.length) advance()
                    continue
                }
                if (content[index] === quote) {
                    if (quote === "'" && content[index + 1] === "'") {
                        advance()
                        advance()
                        continue
                    }
                    advance()
                    break
                }
                advance()
            }
            continue
        }
        if ("{}()[];,".includes(character)) {
            tokens.push({ value: character, line })
            advance()
            continue
        }

        const start = index
        const tokenLine = line
        while (index < content.length) {
            const current = content[index]
            const following = content[index + 1]
            if (
                /\s/.test(current) ||
                ["{", "}", "(", ")", "[", "]", ";", ",", '"', "'"].includes(current) ||
                current === "#" ||
                (current === "<" && following === "#")
            ) {
                break
            }
            advance()
        }
        if (index === start) advance()
        else tokens.push({ value: content.slice(start, index), line: tokenLine })
    }
    return tokens
}

function findClosingToken(tokens: Token[], start: number, opening: string, closing: string): number | undefined {
    let depth = 0
    for (let index = start; index < tokens.length; index++) {
        if (tokens[index].value === opening) depth++
        if (tokens[index].value === closing) depth--
        if (depth === 0) return index
    }
    return undefined
}

function countParameters(tokens: Token[], start: number, end: number): number {
    const names = new Set<string>()
    for (let index = start + 1; index < end; index++) {
        const match = tokens[index].value.match(/^\$([A-Za-z_][\w]*)$/)
        if (match) names.add(match[1].toLowerCase())
    }
    return names.size
}

function findBodyParameterCount(tokens: Token[], bodyStart: number): number {
    let braceDepth = 1
    for (let index = bodyStart + 1; index < tokens.length && braceDepth > 0; index++) {
        const value = tokens[index].value
        if (value === "{") braceDepth++
        if (value === "}") braceDepth--
        if (braceDepth === 1 && value.toLowerCase() === "param" && tokens[index + 1]?.value === "(") {
            const end = findClosingToken(tokens, index + 1, "(", ")")
            return end === undefined ? 1 : countParameters(tokens, index + 1, end)
        }
    }
    return 0
}

function isDeclarationBoundary(tokens: Token[], index: number): boolean {
    const previous = tokens[index - 1]
    return !previous || previous.line < tokens[index].line || [";", "{", "}"].includes(previous.value)
}

function readMetadata(lines: string[], declarationLine: number) {
    const metadata = new Map<string, string>()
    for (let index = declarationLine - 2; index >= 0; index--) {
        const line = lines[index].trim()
        if (!line) continue
        const match = line.match(/^#\s*@raycast\.([\w-]+)(?:\s+(.+))?$/i)
        if (!match) break
        metadata.set(match[1].toLowerCase(), match[2]?.trim() ?? "true")
    }

    const configuredTimeout = Number(metadata.get("timeout"))
    return {
        title: metadata.get("title"),
        icon: metadata.get("icon") ?? DEFAULT_ICON,
        description: metadata.get("description"),
        keywords: (metadata.get("keywords") ?? "")
            .split(",")
            .map(keyword => keyword.trim())
            .filter(Boolean),
        requiresConfirmation: metadata.get("confirm")?.toLowerCase() === "true",
        timeout:
            Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout * 1000 : DEFAULT_TIMEOUT,
    }
}

export function parsePowerShellFunctions(content: string): PowerShellFunction[] {
    const tokens = tokenize(content)
    const lines = content.split(/\r?\n/)
    const functions: PowerShellFunction[] = []
    for (let index = 0; index < tokens.length; index++) {
        if (tokens[index].value.toLowerCase() !== "function") continue
        if (!isDeclarationBoundary(tokens, index)) continue
        const nameToken = tokens[index + 1]
        const nameMatch = nameToken?.value.match(FUNCTION_NAME)
        if (!nameMatch) continue

        let cursor = index + 2
        let parameterCount = 0
        if (tokens[cursor]?.value === "(") {
            const end = findClosingToken(tokens, cursor, "(", ")")
            if (end === undefined) continue
            parameterCount = countParameters(tokens, cursor, end)
            cursor = end + 1
        }
        while (cursor < tokens.length && tokens[cursor].value !== "{") {
            if (tokens[cursor].value.toLowerCase() === "function" && tokens[cursor].line > nameToken.line) break
            cursor++
        }
        if (cursor >= tokens.length || parameterCount > 0) continue
        if (tokens[cursor].value !== "{") continue
        parameterCount = findBodyParameterCount(tokens, cursor)
        if (parameterCount > 0) continue
        functions.push({ name: nameMatch[1], line: nameToken.line, ...readMetadata(lines, tokens[index].line) })
    }
    return functions
}
