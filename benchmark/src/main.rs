#![feature(f16)]

mod benchmark;
mod cli;
mod config;
mod context;
mod kernel;
mod plan;
mod report;

use clap::{CommandFactory, Parser};

use crate::cli::Cli;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if cli.is_unpinned() {
        Cli::command().print_help()?;
        return Ok(());
    }
    let plan = cli.into_plan()?;
    for notice in &plan.skipped {
        eprintln!("{notice}");
    }
    let records = benchmark::run(&plan)?;

    report::print_results_table(&records);
    report::write_records(plan.output, &records)?;
    eprintln!(
        "Wrote {} records to {}",
        records.len(),
        plan.output_path.display()
    );
    Ok(())
}
