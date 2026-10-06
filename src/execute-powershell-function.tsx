import {
    Action,
    ActionPanel,
    Alert,
    Clipboard,
    confirmAlert,
    getPreferenceValues,
    Icon,
    List,
    openExtensionPreferences,
    showToast,
    Toast,
} from "@raycast/api"
import { usePromise } from "@raycast/utils"
import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { useState } from "react"
import { executePowerShellFunction } from "./powershell/executor"
import { clearFunctionCache, loadFunctions } from "./powershell/function-store"
import { PowerShellFunction } from "./powershell/parser"

function resolveConfiguredPath(scriptPath: string): Promise<string> {
    return realpath(scriptPath.replace(/^~(?=$|[\\/])/, homedir()))
}

function getIcon(iconName: string): Icon {
    const iconKey = iconName.split(".")[1]
    return iconKey && iconKey in Icon ? Icon[iconKey as keyof typeof Icon] : Icon.Cog
}

async function runFunction(func: PowerShellFunction, scriptPath: string) {
    const displayName = func.title ?? func.name
    if (
        func.requiresConfirmation &&
        !(await confirmAlert({
            title: "Execute " + displayName + "?",
            message: "This function is marked as requiring confirmation.",
            primaryAction: { title: "Execute", style: Alert.ActionStyle.Destructive },
        }))
    ) {
        return
    }

    const controller = new AbortController()
    const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Executing "' + displayName + '"',
        primaryAction: {
            title: "Cancel",
            onAction: () => controller.abort(),
        },
    })

    try {
        const { stdout, stderr } = await executePowerShellFunction(func.name, scriptPath, {
            signal: controller.signal,
            timeout: func.timeout,
        })
        const output = stdout.trim() || stderr.trim()
        toast.style = Toast.Style.Success
        toast.title = 'Executed "' + displayName + '"'
        toast.message = output || undefined
        toast.primaryAction = output
            ? {
                  title: "Copy Output",
                  onAction: () => Clipboard.copy(output),
              }
            : undefined
    } catch (error) {
        toast.style = Toast.Style.Failure
        toast.title = controller.signal.aborted ? "Execution Cancelled" : 'Failed to Execute "' + displayName + '"'
        toast.message = error instanceof Error ? error.message : "An unknown error occurred"
    }
}

function PreferencesAction() {
    return <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
}

function FunctionItem({
    func,
    scriptPath,
    onReload,
}: {
    func: PowerShellFunction
    scriptPath: string
    onReload: () => void
}) {
    return (
        <List.Item
            title={func.title ?? func.name}
            subtitle={func.title ? func.name : func.description}
            keywords={[func.name, ...func.keywords]}
            icon={getIcon(func.icon)}
            accessories={func.description && func.title ? [{ text: func.description }] : undefined}
            actions={
                <ActionPanel>
                    <Action title="Execute Function" icon={Icon.Play} onAction={() => runFunction(func, scriptPath)} />
                    <Action.Open title="Edit Script" target={scriptPath} icon={Icon.Pencil} />
                    <Action
                        title="Reload Functions"
                        icon={Icon.Repeat}
                        onAction={onReload}
                        shortcut={{ modifiers: ["ctrl"], key: "r" }}
                    />
                    <PreferencesAction />
                </ActionPanel>
            }
        />
    )
}

export default function Command() {
    const { scriptPath } = getPreferenceValues<Preferences>()
    const [reloadCount, setReloadCount] = useState(0)
    const { data, isLoading, error } = usePromise(
        async (configuredPath: string, reload: number) => {
            const resolvedPath = await resolveConfiguredPath(configuredPath)
            return {
                resolvedPath,
                functions: await loadFunctions(resolvedPath, reload > 0),
            }
        },
        [scriptPath, reloadCount],
    )

    const handleReload = () => {
        if (data?.resolvedPath) clearFunctionCache(data.resolvedPath)
        setReloadCount(value => value + 1)
    }

    if (error) {
        return (
            <List>
                <List.EmptyView
                    title="Unable to Read PowerShell Script"
                    description={error.message}
                    icon={Icon.XMarkCircle}
                    actions={
                        <ActionPanel>
                            <Action title="Retry" icon={Icon.Repeat} onAction={handleReload} />
                            <PreferencesAction />
                        </ActionPanel>
                    }
                />
            </List>
        )
    }

    return (
        <List isLoading={isLoading} searchBarPlaceholder="Filter functions...">
            {data?.functions.map(func => (
                <FunctionItem
                    key={func.name + "-" + func.line}
                    func={func}
                    scriptPath={data.resolvedPath}
                    onReload={handleReload}
                />
            ))}
            {!isLoading && data?.functions.length === 0 ? (
                <List.EmptyView
                    title="No Parameterless Functions Found"
                    description="Only functions without declared parameters are listed."
                    icon={Icon.Cog}
                    actions={
                        <ActionPanel>
                            <Action title="Reload Functions" icon={Icon.Repeat} onAction={handleReload} />
                            <PreferencesAction />
                        </ActionPanel>
                    }
                />
            ) : null}
        </List>
    )
}
