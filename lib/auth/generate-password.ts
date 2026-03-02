const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SPECIAL = "!@#$%&*?";
const ALL_CHARACTERS = `${UPPERCASE}${LOWERCASE}${NUMBERS}${SPECIAL}`;

function getCrypto(): Crypto {
  const cryptoObject = globalThis.crypto;

  if (!cryptoObject) {
    throw new Error("Crypto API is unavailable in this environment.");
  }

  return cryptoObject;
}

function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("randomInt maxExclusive must be a positive integer.");
  }

  const cryptoObject = getCrypto();
  const maxUint32 = 0xffffffff;
  const cutoff = Math.floor((maxUint32 + 1) / maxExclusive) * maxExclusive;

  while (true) {
    const buffer = new Uint32Array(1);
    cryptoObject.getRandomValues(buffer);
    const candidate = buffer[0];

    if (candidate < cutoff) {
      return candidate % maxExclusive;
    }
  }
}

function pickCharacters(source: string, count: number): string[] {
  return Array.from({ length: count }, () => source[randomInt(source.length)]);
}

function shuffle(values: string[]): string[] {
  const output = [...values];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const currentValue = output[index];
    output[index] = output[swapIndex];
    output[swapIndex] = currentValue;
  }

  return output;
}

export function generateStrongPassword(): string {
  const passwordLength = 16;
  const minimumPerBucket = 2;

  const requiredCharacters = [
    ...pickCharacters(UPPERCASE, minimumPerBucket),
    ...pickCharacters(LOWERCASE, minimumPerBucket),
    ...pickCharacters(NUMBERS, minimumPerBucket),
    ...pickCharacters(SPECIAL, minimumPerBucket)
  ];

  const remainingLength = passwordLength - requiredCharacters.length;
  const remainingCharacters = pickCharacters(ALL_CHARACTERS, remainingLength);

  return shuffle([...requiredCharacters, ...remainingCharacters]).join("");
}
