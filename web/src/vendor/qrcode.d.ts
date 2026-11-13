// QR Code Generator for JavaScript — Copyright (c) 2009 Kazuhiko Arase, MIT licence (see qrcode-LICENSE.txt)
interface QRCode {
  addData(data: string, mode?: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
declare const qrcode: (typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H') => QRCode;
export default qrcode;
