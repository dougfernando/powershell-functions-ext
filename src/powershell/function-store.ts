import { Cache } from "@raycast/api"
import { readFile, stat } from "node:fs/promises"
import { parsePowerShellFunctions, PowerShellFunction } from "./parser"

const CACHE_VERSION = 2
const cache = new Cache()

interface CachedFunctions {
    version: number
    mtimeMs: number
    size: number
    functions: PowerShellFunction[]
}

function getCacheKey(filePath: string): string {
    return "functions-" + filePath
}

export function clearFunctionCache(filePath: string): void {
    cache.remove(getCacheKey(filePath))
}

export async function loadFunctions(filePath: string, forceReload = false): Promise<PowerShellFunction[]> {
    const fileStats = await stat(filePath)
    const cacheKey = getCacheKey(filePath)

    if (!forceReload) {
        const serialized = cache.get(cacheKey)
        if (serialized) {
            try {
                const cached = JSON.parse(serialized) as CachedFunctions
                if (
                    cached.version === CACHE_VERSION &&
                    cached.mtimeMs === fileStats.mtimeMs &&
                    cached.size === fileStats.size
                ) {
                    return cached.functions
                }
            } catch {
                cache.remove(cacheKey)
            }
        }
    }

    const content = await readFile(filePath, "utf8")
    const functions = parsePowerShellFunctions(content)
    cache.set(
        cacheKey,
        JSON.stringify({
            version: CACHE_VERSION,
            mtimeMs: fileStats.mtimeMs,
            size: fileStats.size,
            functions,
        }),
    )
    return functions
}
