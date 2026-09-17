// CSV export for the stats board. Web triggers a browser download,
// native writes to the cache dir and opens the system share sheet.
// Kept separate from stats_board so unit tests never load native modules.
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

type DomLike = {
  Blob: new (parts: string[], opts: { type: string }) => { size: number };
  URL: { createObjectURL: (blob: unknown) => string; revokeObjectURL: (url: string) => void };
  document: {
    createElement: (tag: string) => {
      href: string;
      download: string;
      click: () => void;
      remove: () => void;
    };
    body: { appendChild: (el: unknown) => void };
  };
};

export async function shareCsvFile(csv: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    const dom = globalThis as unknown as DomLike;
    const blob = new dom.Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = dom.URL.createObjectURL(blob);
    try {
      const a = dom.document.createElement("a");
      a.href = url;
      a.download = filename;
      dom.document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => dom.URL.revokeObjectURL(url), 1000);
    }
    return;
  }
  const file = new File(Paths.cache, filename);
  const stream = file.writableStream();
  const writer = stream.getWriter();
  try {
    await writer.write(new TextEncoder().encode(csv));
  } finally {
    await writer.close();
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: filename });
}
