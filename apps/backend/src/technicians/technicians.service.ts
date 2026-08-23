import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Technician } from './technician.entity';

/** POC-only lightweight technician identity (dev login by email). */
@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(Technician)
    private readonly repo: Repository<Technician>,
  ) {}

  async findOrCreate(email: string, displayName?: string): Promise<Technician> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { email: normalized } });
    if (existing) return existing;
    const tech = this.repo.create({
      email: normalized,
      displayName: displayName?.trim() || normalized.split('@')[0] || 'Technician',
    });
    return this.repo.save(tech);
  }

  async findById(id: string): Promise<Technician | null> {
    return this.repo.findOne({ where: { id } });
  }
}
