use anyhow::Result;
use poise::CreateReply;
use serenity::all::CreateEmbed;
use chupkarivy_session::manager::SessionQuery;
use chupkarivy_utils::discord::Colors;

use crate::bot::Context;

/// Skip to the next track
#[poise::command(slash_command, guild_only)]
pub async fn skip(ctx: Context<'_>) -> Result<()> {
    let manager = ctx.data();
    let guild = ctx.guild_id().expect("poise lied to me");

    let Some(session) = manager.get_session(SessionQuery::Guild(guild)) else {
        ctx.send(
            CreateReply::default()
                .embed(
                    CreateEmbed::new()
                        .title("Cannot skip track")
                        .description("I'm currently not connected to any voice channel.")
                        .color(Colors::Error),
                )
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    let player = session.player().await?;
    player.next_track().await;

    ctx.send(
        CreateReply::default().embed(
            CreateEmbed::new()
                .title("Skipped Track")
                .description("⏭️ Skipped to the next track.")
                .color(Colors::Info),
        ),
    )
    .await?;

    Ok(())
}
