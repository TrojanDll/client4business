import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ApproveRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RejectRequestDto {
  @IsString()
  @Length(1, 2000)
  reason!: string;
}

export class CancelRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
