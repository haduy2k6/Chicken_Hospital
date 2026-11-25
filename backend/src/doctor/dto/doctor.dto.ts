import { Transform, Type } from 'class-transformer';
import {
  IsIn, IsInt, IsISO8601, IsNotEmpty, IsNotEmptyObject, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min,
  Validate, ValidateIf, ValidateNested, ValidatorConstraint,
  type ValidationArguments, type ValidatorConstraintInterface,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@ValidatorConstraint({ name: 'maxJsonSize' })
class MaxJsonSize implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    try {
      return JSON.stringify(value ?? null).length <= (args.constraints[0] as number);
    } catch {
      return false;
    }
  }
  defaultMessage(args: ValidationArguments) {
    return `${args.property} vượt quá ${args.constraints[0]} ký tự`;
  }
}

export class QueueQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'escalated', 'reviewed'])
  status?: 'all' | 'pending' | 'escalated' | 'reviewed';

  @IsOptional() @IsString() @MaxLength(50)
  specialty?: string;
}

export class ReferralDto {
  @IsOptional() @IsUUID() toDoctorId?: string;
  @IsOptional() @IsUUID() toSpecialtyId?: string;
}

export class ReviewCaseDto {
  @IsIn(['reviewed', 'escalated'])
  status!: 'reviewed' | 'escalated';

  @Transform(trim)
  @IsString() @IsNotEmpty() @MaxLength(5000)
  notes!: string;

  @IsInt() @Min(0)
  expectedVersion!: number;

  @IsOptional() @IsObject() @Validate(MaxJsonSize, [20_000])
  assessmentData?: Record<string, unknown>;

  /** Chỉ áp dụng khi status = reviewed */
  @ValidateIf((o: ReviewCaseDto) => o.status === 'reviewed')
  @IsOptional() @IsISO8601({ strict: true })
  followUpAt?: string;

  /** Bắt buộc khi status = escalated (service kiểm tra thêm phải có ít nhất 1 đích) */
  @ValidateIf((o: ReviewCaseDto) => o.status === 'escalated')
  @IsNotEmptyObject() @ValidateNested() @Type(() => ReferralDto)
  referral?: ReferralDto;
}
