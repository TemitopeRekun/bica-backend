import { maskNin } from './mask.util';

describe('maskNin', () => {
  it('should mask all but the last 4 characters of a standard NIN', () => {
    const input = '12345678901';
    const expected = '*******8901';
    expect(maskNin(input)).toBe(expected);
  });

  it('should return null or undefined as-is', () => {
    expect(maskNin(null)).toBeNull();
    expect(maskNin(undefined)).toBeNull();
  });

  it('should not mask if input length is 4 or less', () => {
    expect(maskNin('123')).toBe('123');
    expect(maskNin('1234')).toBe('1234');
  });

  it('should trim surrounding whitespace before masking', () => {
    const input = '  12345678901  ';
    const expected = '*******8901';
    expect(maskNin(input)).toBe(expected);
  });
});
