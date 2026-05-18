import fs from 'fs';
import path from 'path';

const financePath = path.join(process.cwd(), 'app/(tabs)/finance.tsx');
const lines = fs.readFileSync(financePath, 'utf8').split(/\r?\n/);

const modalStart = lines.findIndex((l) => l.includes('<Modal visible={isSheetVisible}'));
const modalEnd = lines.findIndex((l, i) => i > modalStart && l.trim() === '</Modal>' && lines[i - 1]?.includes('</View>'));
console.log('modal', modalStart + 1, modalEnd + 1);

const styleStart = lines.findIndex((l) => l.trim() === 'sheetOverlay: {');
const styleEnd = lines.findIndex((l, i) => i > styleStart && l.trim() === '},' && lines[i + 1]?.trim().startsWith('budgetKeyboardAvoidingRoot'));
console.log('styles', styleStart + 1, styleEnd + 1);
