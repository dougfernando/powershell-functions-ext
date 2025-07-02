/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** PowerShell Script Path - The full path to your .ps1 file. Use ~ for your home directory. */
  "scriptPath": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `execute-powershell-function` command */
  export type ExecutePowershellFunction = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `execute-powershell-function` command */
  export type ExecutePowershellFunction = {}
}

