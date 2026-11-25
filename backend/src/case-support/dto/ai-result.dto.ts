import { IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AiResultDto {
  @IsUUID() analysis_id!: string;
  @IsIn(['completed', 'failed']) status!: 'completed' | 'failed';

  @IsOptional() @IsString() @MaxLength(100) model_name?: string;
  @IsOptional() @IsString() @MaxLength(50) model_version?: string;
  @IsOptional() @IsString() @MaxLength(100) predicted_label?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100) risk_score?: number;
  @IsOptional() @IsObject() probabilities?: Record<string, number>;

  @IsOptional() @IsString() @MaxLength(500) gradcam_key?: string;
  @IsOptional() @IsObject() raw_output?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) error_message?: string;
}
