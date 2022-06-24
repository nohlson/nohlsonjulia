@def title = "Music"
@def subtitle = "Terrible music"
@def tags = ["music", "nohlson"]



~~~
<div>
	<style scoped>
		.ignore-css{all:unset;}
	</style>
	<style scoped>@import url("/css/audio.css")</style>

<div class="player">
    <div class="player__header">

      <div class="player__img player__img--absolute slider">

        <button class="player__button player__button--absolute--nw playlist">

          <img src="http://physical-authority.surge.sh/imgs/icon/playlist.svg" alt="playlist-icon">

        </button>

        <button class="player__button player__button--absolute--center play">

          <img src="http://physical-authority.surge.sh/imgs/icon/play.svg" alt="play-icon">
          <img src="http://physical-authority.surge.sh/imgs/icon/pause.svg" alt="pause-icon">

        </button>

        <div class="slider__content">

          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/1.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/2.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/3.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/4.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/5.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/6.jpg" alt="cover">
          <img class="img slider__img" src="http://physical-authority.surge.sh/imgs/7.jpg" alt="cover">

        </div>

      </div>

      <div class="player__controls">

        <button class="player__button back">

          <img class="img" src="http://physical-authority.surge.sh/imgs/icon/back.svg" alt="back-icon">

        </button>
        
        <p class="player__context slider__context">

          <strong class="slider__name"></strong>
          <span class="player__title slider__title"></span>

        </p>

        <button class="player__button next">

          <img class="img" src="http://physical-authority.surge.sh/imgs/icon/next.svg" alt="next-icon">

        </button>

        <div class="progres">

          <div class="progres__filled"></div>

        </div>

      </div>

    </div>

    <ul class="player__playlist list">

      <li class="player__song">

        <img class="player__img img" src="http://physical-authority.surge.sh/imgs/1.jpg" alt="cover">

        <p class="player__context">

          <b class="player__song-name">I Had That Dream</b>
          <span class="flex">

            <span class="player__title">alltrue</span>
            <span class="player__song-time"></span>

          </span>

        </p>

        <audio class="audio" src="/assets/music/I_Had_That_Dream.mp3"></audio>

      </li>

    </ul>

  </div>
</div>
<script src="/libs/audio/audio.js"></script>


~~~
