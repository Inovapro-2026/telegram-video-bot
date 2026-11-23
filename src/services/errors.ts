export class YouTubeAccessError extends Error {
  public readonly name = 'YouTubeAccessError';
}

export class FileTooLargeError extends Error {
  public readonly name = 'FileTooLargeError';

  constructor(
    public readonly bytes: number,
    public readonly limitBytes: number,
  ) {
    super('Arquivo final excede o limite configurado.');
  }
}

export class DownloadCancelledError extends Error {
  public readonly name = 'DownloadCancelledError';

  constructor() {
    super('Download cancelado pelo usuário.');
  }
}

export class VerificationError extends Error {
  public readonly name = 'VerificationError';
}

export class TelegramFileTooLargeError extends Error {
  public readonly name = 'TelegramFileTooLargeError';
}
