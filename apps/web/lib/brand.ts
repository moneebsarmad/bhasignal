const envAppName = process.env.NEXT_PUBLIC_APP_NAME?.trim();

export const APP_NAME = envAppName && envAppName.length > 0 ? envAppName : "Signal";
export const APP_CATEGORY = "School discipline";
export const APP_DESCRIPTION = `${APP_NAME} is the discipline operations workspace for synced records, review, and accountability.`;
