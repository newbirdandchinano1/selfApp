import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** 将相册临时文件复制到应用文档目录，避免系统清理后丢失 */
export async function persistRecipeFinishedImage(
  recipeId: string,
  sourceUri: string | null | undefined,
): Promise<string | null> {
  if (!sourceUri) return null;
  if (Platform.OS === 'web') return sourceUri;

  try {
    const doc = Paths.document;
    const docUri = doc.uri;
    if (!docUri) return sourceUri;

    const docPrefix = docUri.endsWith('/') ? docUri : `${docUri}/`;
    if (sourceUri.startsWith(docPrefix) && sourceUri.includes('recipe_photos')) {
      return sourceUri;
    }

    const photoDir = new Directory(doc, 'recipe_photos');
    photoDir.create({ idempotent: true, intermediates: true });

    const safeExt = sourceUri.match(/\.([a-zA-Z0-9]{1,8})(?:\?|$)/)?.[1]?.toLowerCase() ?? 'jpg';
    const safeId = recipeId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const dest = new File(
      photoDir,
      `${safeId}_${Date.now().toString(36)}.${safeExt}`,
    );
    const src = new File(sourceUri);
    src.copy(dest);
    return dest.uri;
  } catch {
    return sourceUri;
  }
}
